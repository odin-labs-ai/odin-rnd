import { apiOrigin, readConfig } from './activity.mjs';
export const topics = Object.freeze(['test-witness','migration-witness','ci-witness','factory-intelligence','odin-gym','other']);
export function submissionPayload(input) {
  const body = {name:String(input.name ?? '').trim(),email:String(input.email ?? '').trim(),topic:input.topic,message:String(input.message ?? '').trim(),sharingAccepted:input.sharingAccepted};
  if ([body.name,body.email,body.message].some(value=>value.includes('\u0000'))) throw new Error('Remove unsupported control characters from your details.');
  if (!body.name || body.name.length > 120) throw new Error('Enter your name (up to 120 characters).');
  if (body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) throw new Error('Enter a valid email address.');
  if (!topics.includes(body.topic)) throw new Error('Choose an enquiry topic.');
  if (!body.message || body.message.length > 5000) throw new Error('Enter a message (up to 5,000 characters).');
  if (body.sharingAccepted !== true) throw new Error('Confirm that you want to share these details with Odin.');
  if (new TextEncoder().encode(JSON.stringify(body)).length > 16 * 1024) throw new Error('Your message is too large. Please shorten it.');
  return body;
}
export function createSubmissionClient(origin, {fetcher = globalThis.fetch, uuid = () => crypto.randomUUID()} = {}) {
  origin = apiOrigin(origin);
  let request = null, pending = false, accepted = null;
  return {
    get locked() { return request !== null; },
    get pending() { return pending; },
    async submit(input) {
      if (!origin) return {state:'unavailable'};
      if (pending) return {state:'pending'};
      if (accepted) return accepted;
      const retrying = request !== null;
      if (!request) request = {key:uuid(),payload:submissionPayload(input)};
      pending = true;
      try {
        const response = await fetcher(`${origin}/v1/rd/submissions`, {
          method:'POST',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
          headers:{'Content-Type':'application/json','Idempotency-Key':request.key},
          body:JSON.stringify(request.payload),signal:AbortSignal.timeout(15000),
        });
        if (response.status === 202) {
          const receipt = await response.json();
          if (receipt?.status !== 'accepted' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.id)) return {state:'uncertain'};
          accepted = {state:'accepted',id:receipt.id};
          return accepted;
        }
        // A key conflict needs investigation: never silently generate a second key.
        if (response.status === 409) return {state:'conflict'};
        if ([400,403,413,415,422,429].includes(response.status)) {
          if (retrying) return {state:'uncertain'};
          request = null;
          return {state:response.status === 429 ? 'limited' : 'rejected'};
        }
        return {state:'uncertain'};
      } catch { return {state:'uncertain'}; }
      finally { pending = false; }
    },
  };
}
export function bindIntake(doc, origin, dependencies = {}) {
  const form = doc.getElementById('enquiry-form');
  if (!form) return;
  const status = doc.getElementById('enquiry-status');
  if (!origin) { status.textContent = 'The enquiry form is not available yet. You can email Odin using the contact link.'; return; }
  const client = createSubmissionClient(origin,dependencies);
  const fields = ['name','email','topic','message','sharingAccepted'].map(name => form.elements.namedItem(name));
  const button = doc.getElementById('send-enquiry');
  const lock = locked => fields.forEach(field => { field.disabled = locked; });
  form.hidden = false;
  status.textContent = '';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (client.pending) return;
    const input = Object.fromEntries(fields.map(field => [field.name,field.type === 'checkbox' ? field.checked : field.value]));
    button.disabled = true; lock(true); form.setAttribute('aria-busy','true'); status.textContent = 'Sending your enquiry…';
    let result;
    try { result = await client.submit(input); }
    catch (error) { result = {state:'invalid',message:error.message}; }
    form.setAttribute('aria-busy','false');
    button.disabled = result.state === 'accepted' || result.state === 'conflict';
    lock(client.locked);
    const messages = {
      accepted:`Enquiry received. Your reference is ${result.id}. This confirms receipt; it does not mean someone has read it yet.`,
      uncertain:'We could not confirm receipt. Retry uses the same request key. Keep this page open until receipt is confirmed; your entries remain here.',
      conflict:'We could not reconcile this enquiry request. Please contact Odin by email. Do not send another copy through this form.',
      limited:'Too many requests. Please wait a minute before trying again. Your entries are still here.',
      rejected:'The enquiry was not accepted. Check your entries and try again, or contact Odin by email.',
      unavailable:'The enquiry service is unavailable. Your entries have not been sent.',
    };
    status.textContent = result.state === 'invalid' ? result.message : messages[result.state] ?? 'Please wait while your enquiry is sent.';
    button.textContent = result.state === 'uncertain' ? 'Retry this enquiry' : result.state === 'accepted' ? 'Enquiry received' : 'Send enquiry';
    status.focus();
  });
}
if (typeof document !== 'undefined') readConfig().then(origin => bindIntake(document,origin)).catch(() => bindIntake(document,null));
