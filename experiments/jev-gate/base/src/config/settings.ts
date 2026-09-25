export interface Settings {
  port: number;
  databaseUrl: string;
  logLevel: 'debug' | 'info' | 'warn';
  smtpHost: string;
  smtpFrom: string;
  invoicePrefix: string;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`missing setting ${name}`);
  return value;
}

export function loadSettings(): Settings {
  return {
    port: Number(process.env.PORT ?? '8080'),
    databaseUrl: required('DATABASE_URL', process.env.DATABASE_URL),
    logLevel: (process.env.LOG_LEVEL ?? 'info') as Settings['logLevel'],
    smtpHost: required('SMTP_HOST', process.env.SMTP_HOST),
    smtpFrom: process.env.SMTP_FROM ?? 'no-reply',
    invoicePrefix: process.env.INVOICE_PREFIX ?? 'INV',
  };
}
