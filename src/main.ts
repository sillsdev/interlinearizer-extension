import { logger } from '@papi/backend';

export async function activate() {
  logger.debug('Interlinearizer is activating!');
}

export async function deactivate() {
  logger.debug('Interlinearizer is deactivating!');
  return true;
}
