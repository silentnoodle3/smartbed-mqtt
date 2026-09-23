import { Sensor } from '@ha/Sensor';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { ICache } from 'Common/ICache';
import { RevCBController } from './RevCBController';

interface Cache {
  headPosition?: Sensor<string>;
  footPosition?: Sensor<string>;
}

// Raw, uncalibrated position counters reported by the controller (not a real degree
// measurement - we don't yet know the true min/max range for this bed's motors).
//
// State is published as a string, not the raw number: MQTTConnection.publish only
// JSON-stringifies values that are `instanceof Object`, which a primitive number is
// not, so a raw number payload reaches the mqtt client's publish() unstringified and
// it throws (ERR_INVALID_ARG_TYPE, expects string|Buffer). No other entity in this
// codebase publishes a bare number, so this is a good place to just avoid it.
export const setupPositionSensors = (mqtt: IMQTTConnection, controller: RevCBController & ICache<Cache>) => {
  const { cache, deviceData, on } = controller;

  // Retained: this value only ever changes via a live BLE notify, so without retain an HA Core
  // restart wipes it to "unknown" until the bed happens to move again - see setupConnectionAvailability.ts
  // for the same reasoning applied to the BLE diagnostic sensors.
  if (!cache.headPosition) {
    cache.headPosition = new Sensor<string>(mqtt, deviceData, buildEntityConfig('HeadPosition'), true).setOnline();
    on('headPosition', (data) => cache.headPosition!.setState(data[0].toString()));
  }

  if (!cache.footPosition) {
    cache.footPosition = new Sensor<string>(mqtt, deviceData, buildEntityConfig('FootPosition'), true).setOnline();
    on('footPosition', (data) => cache.footPosition!.setState(data[0].toString()));
  }
};
