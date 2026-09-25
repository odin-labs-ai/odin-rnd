import { loadSettings } from './config/settings';
import { createHttpServer, createServices } from './infra';

const settings = loadSettings();
const services = createServices(settings);
createHttpServer(services).listen(settings.port, () => {
  console.log(`ledger-service listening on ${settings.port}`);
});
