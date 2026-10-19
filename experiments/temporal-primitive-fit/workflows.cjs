const {proxyActivities}=require('@temporalio/workflow');
const {mutate}=proxyActivities({startToCloseTimeout:'30 seconds',retry:{maximumAttempts:3,initialInterval:'1 second',maximumInterval:'2 seconds'}});
exports.primitiveMutation=async input=>mutate(input);
