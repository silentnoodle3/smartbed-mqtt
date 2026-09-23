import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { logError } from '@utils/logger';
import { IDeviceData } from './IDeviceData';
import { EntityConfig } from './base/Entity';
import { StatefulEntity } from './base/StatefulEntity';

export type NumberSliderConfig = {
  min?: number;
  max?: number;
  icon?: string;
  mode?: 'slider' | 'box' | 'auto';
  // Not retained by default, matching every other entity here. Opt in for a value that only ever
  // changes via a live BLE notify, so an HA Core restart doesn't wipe it to "unknown" until the bed
  // happens to move again - see Reverie/revcb/setupPositionInputs.ts.
  retain?: boolean;
};

export class NumberSlider extends StatefulEntity<number> {
  private commandTopic: string;
  private min: number;
  private max: number;
  private icon?: string;
  private mode: 'slider' | 'box' | 'auto';

  constructor(
    mqtt: IMQTTConnection,
    deviceData: IDeviceData,
    { min = 0, max = 100, icon, mode = 'slider', retain = false, ...config }: EntityConfig & NumberSliderConfig,
    onChange: (state: number) => Promise<void | number>
  ) {
    super(mqtt, deviceData, config, 'number', retain);
    this.min = min;
    this.max = max;
    this.icon = icon;
    this.mode = mode;
    this.commandTopic = `${this.baseTopic}/command`;

    mqtt.subscribe(this.commandTopic);
    mqtt.on(this.commandTopic, async (message) => {
      const value = parseInt(message);
      if (Number.isNaN(value)) return;
      try {
        const result = await onChange(value);
        this.setState(result === undefined ? value : result);
      } catch (err) {
        logError(err);
      }
    });
  }

  mapState(state?: number): string | null {
    return state == undefined ? null : state.toString();
  }

  discoveryState() {
    return {
      ...super.discoveryState(),
      command_topic: this.commandTopic,
      mode: this.mode,
      icon: this.icon,
      min: this.min,
      max: this.max,
    };
  }
}
