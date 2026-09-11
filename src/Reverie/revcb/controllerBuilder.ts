import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { logInfo } from '@utils/logger';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';
import { RevCBController } from './RevCBController';
import { setupLightEntities } from './setupLightEntities';
import { setupMotorEntities } from './setupMotorEntities';
import { setupPositionSensors } from './setupPositionSensors';
import { setupPresetButtons } from './setupPresetButtons';

const SERVICE_UUID = 'db801000-f324-29c3-38d1-85c0c2e86885';

const CHARACTERISTIC_UUIDS = {
  preset: 'db8010d0-f324-29c3-38d1-85c0c2e86885',
  headMotor: 'db801021-f324-29c3-38d1-85c0c2e86885',
  headPosition: 'db801041-f324-29c3-38d1-85c0c2e86885',
  footMotor: 'db801022-f324-29c3-38d1-85c0c2e86885',
  footPosition: 'db801042-f324-29c3-38d1-85c0c2e86885',
  light: 'db8010a0-f324-29c3-38d1-85c0c2e86885',
};

export const controllerBuilder = async (mqtt: IMQTTConnection, deviceData: IDeviceData, bleDevice: IBLEDevice) => {
  const { name, getCharacteristic } = bleDevice;

  const resolved = await Promise.all(
    Object.entries(CHARACTERISTIC_UUIDS).map(
      async ([key, uuid]) => [key, await getCharacteristic(SERVICE_UUID, uuid)] as const
    )
  );

  const missing = resolved.filter(([, characteristic]) => !characteristic).map(([key]) => key);
  if (missing.length) {
    logInfo('[Reverie] Could not find expected characteristics for device:', name, missing);
    return undefined;
  }

  const handles = Object.fromEntries(resolved.map(([key, characteristic]) => [key, characteristic!.handle]));

  const controller = new RevCBController(
    deviceData,
    bleDevice,
    { preset: handles.preset, headMotor: handles.headMotor, footMotor: handles.footMotor, light: handles.light },
    { headPosition: handles.headPosition, footPosition: handles.footPosition }
  );

  logInfo('[Reverie] Setting up entities for device:', name);
  setupPresetButtons(mqtt, controller);
  setupLightEntities(mqtt, controller);
  setupMotorEntities(mqtt, controller);
  setupPositionSensors(mqtt, controller);

  return controller;
};
