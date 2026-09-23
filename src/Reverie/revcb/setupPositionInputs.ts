import { NumberSlider } from '@ha/NumberSlider';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { ICache } from 'Common/ICache';
import { Commands } from './Commands';
import { RevCBController } from './RevCBController';

interface Cache {
  headTarget?: NumberSlider;
  footTarget?: NumberSlider;
}

// A numeric alternative to dragging the cover's position slider - typing a value here
// sends the same absolute-position command as the cover (see setupMotorEntities), and
// stays in sync with the bed's live position regardless of how it was actually moved
// (this input, the cover's own slider, a preset, or a memory recall), since it listens
// to the same position notify events everything else here does.
export const setupPositionInputs = (mqtt: IMQTTConnection, controller: RevCBController & ICache<Cache>) => {
  const { cache, deviceData, writeCommand, on } = controller;

  if (!cache.headTarget) {
    cache.headTarget = new NumberSlider(
      mqtt,
      deviceData,
      { ...buildEntityConfig('HeadTarget', { icon: 'mdi:head' }), mode: 'box', retain: true },
      async (value) => void writeCommand(Commands.HeadTo(value))
    ).setOnline();
    on('headPosition', (data) => cache.headTarget!.setState(data[0]));
  }

  if (!cache.footTarget) {
    cache.footTarget = new NumberSlider(
      mqtt,
      deviceData,
      { ...buildEntityConfig('FootTarget', { icon: 'mdi:foot-print' }), mode: 'box', retain: true },
      async (value) => void writeCommand(Commands.FootTo(value))
    ).setOnline();
    on('footPosition', (data) => cache.footTarget!.setState(data[0]));
  }
};
