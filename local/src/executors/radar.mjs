
import { addToRadar, updateRadarStage, listRadar } from '../skills/radar.mjs';

export async function runRadar(step) {
  const { action, params } = step.params || {};

  switch (action) {
    case 'add':
      return await addToRadar(params);
    case 'update':
      return await updateRadarStage(params);
    case 'list':
      return await listRadar(params?.stage);
    default:
      throw new Error(`Unknown radar action: ${action}`);
  }
}
