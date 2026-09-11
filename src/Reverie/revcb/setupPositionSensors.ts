import { Sensor } from '@ha/Sensor';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { ICache } from 'Common/ICache';
import { RevCBController } from './RevCBController';

interface Cache {
  headPosition?: Sensor<number>;
  footPosition?: Sensor<number>;
}

// Raw, uncalibrated position counters reported by the controller (not a real degree
// measurement - we don't yet know the true min/max range for this bed's motors).
export const setupPositionSensors = (mqtt: IMQTTConnection, controller: RevCBController & ICache<Cache>) => {
  const { cache, deviceData, on } = controller;

  if (!cache.headPosition) {
    cache.headPosition = new Sensor<number>(mqtt, deviceData, buildEntityConfig('HeadPosition')).setOnline();
    on('headPosition', (data) => cache.headPosition!.setState(data[0]));
  }

  if (!cache.footPosition) {
    cache.footPosition = new Sensor<number>(mqtt, deviceData, buildEntityConfig('FootPosition')).setOnline();
    on('footPosition', (data) => cache.footPosition!.setState(data[0]));
  }
};
