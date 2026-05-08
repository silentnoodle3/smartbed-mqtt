import { NumberSlider } from '@ha/NumberSlider';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { ECBController } from './ECBController';

interface Cache {
  underBedLight?: NumberSlider;
}

// Creates a 0–100 number slider in HA for the under-bed light.
// Scan confirmed: 0 = off, 100 = on. Intermediate values may provide
// dimming — this needs testing. If only 0 and 100 work, consider
// replacing with a Switch entity in v2.
export const setupLightEntities = (mqtt: IMQTTConnection, controller: ECBController) => {
  const { deviceData, writeLight } = controller;
  const cache = controller.cache as Cache;

  if (!cache.underBedLight) {
    cache.underBedLight = new NumberSlider(
      mqtt,
      deviceData,
      { min: 0, max: 100, ...buildEntityConfig('UnderBedLightsToggle') },
      async (value) => await writeLight(value)
    ).setOnline();
  }
};
