// Include the frozen experiment's dependency-free units in the existing root CI test glob.
// Live database integration cases remain opt-in through TDF_INTEGRATION=1.
import '../experiments/temporal-document-fit/adapters.test.mjs';
import '../experiments/temporal-document-fit/oracle.test.mjs';
