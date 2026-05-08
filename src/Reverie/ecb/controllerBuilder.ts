import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { logInfo, logWarn } from '@utils/logger';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';
import { CharacteristicUUIDs, SERVICE_UUID } from './Characteristics';
import { ECBController } from './ECBController';
import { setupEventListeners } from './setupEventListeners';
import { setupLightEntities } from './setupLightEntities';
import { setupMotorEntities } from './setupMotorEntities';

export const controllerBuilder = async (
  mqtt: IMQTTConnection,
  deviceData: IDeviceData,
  bleDevice: IBLEDevice
) => {
  const { name, getCharacteristic } = bleDevice;

  // Fetch each characteristic sequentially (ESPHome BLE proxy handles one request at a time)
  const headWrite  = await getCharacteristic(SERVICE_UUID, CharacteristicUUIDs.HeadWrite);
  const footWrite  = await getCharacteristic(SERVICE_UUID, CharacteristicUUIDs.FootWrite);
  const lightChar  = await getCharacteristic(SERVICE_UUID, CharacteristicUUIDs.Light);
  const headNotify = await getCharacteristic(SERVICE_UUID, CharacteristicUUIDs.HeadNotify);
  const footNotify = await getCharacteristic(SERVICE_UUID, CharacteristicUUIDs.FootNotify);

  if (!headWrite || !footWrite || !lightChar || !headNotify || !footNotify) {
    logWarn('[Reverie ECB] Could not find one or more required characteristics for device:', name);
    return undefined;
  }

  const controller = new ECBController(deviceData, bleDevice, {
    headWrite:  headWrite.handle,
    footWrite:  footWrite.handle,
    light:      lightChar.handle,
    headNotify: headNotify.handle,
    footNotify: footNotify.handle,
  });

  logInfo('[Reverie ECB] Setting up entities for device:', name);
  setupMotorEntities(mqtt, controller);
  setupLightEntities(mqtt, controller);
  setupEventListeners(mqtt, controller);

  return controller;
};
