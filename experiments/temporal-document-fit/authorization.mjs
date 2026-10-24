// The caller identity is obtained independently of the request body by the synthetic
// application boundary. This models application authorization, not Temporal ACLs.
export async function sendApproval(handle,authenticatedIdentity,ownerTenant,request){
 if(authenticatedIdentity!==ownerTenant||request.tenantId!==authenticatedIdentity){const error=new Error('Caller is not authorized for this tenant workflow');error.code='FORBIDDEN';throw error;}
 return handle.signal('approval',{tenantId:request.tenantId,opId:request.opId,identity:authenticatedIdentity});
}
