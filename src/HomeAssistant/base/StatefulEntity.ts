import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { ComponentType } from './ComponentTypeWithState';
import { Entity, EntityConfig } from './Entity';
import { IStateful } from './IStateful';

export class StatefulEntity<T> extends Entity implements IStateful<T> {
  stateTopic: string;

  private state?: T;

  constructor(
    mqtt: IMQTTConnection,
    deviceData: IDeviceData,
    entityConfig: EntityConfig,
    componentType: ComponentType,
    private retainState: boolean = false
  ) {
    super(mqtt, deviceData, entityConfig, componentType);
    this.stateTopic = `${this.baseTopic}/state`;
  }

  discoveryState() {
    return {
      ...super.discoveryState(),
      state_topic: this.stateTopic,
    };
  }

  protected mapState(state: T | undefined): any {
    return state === undefined ? null : state;
  }

  setState(state: T | null) {
    if (state === null) {
      return this.setOffline();
    }
    if (this.state === state) return this;
    this.state = state;
    this.sendState();
    this.setOnline();
    return this;
  }

  getState() {
    return this.state;
  }

  private sendState() {
    setTimeout(() => {
      const message = this.mapState(this.state);
      // Only pass the retain argument when actually retaining - keeps the call
      // signature identical to before this option existed for every entity that
      // doesn't opt in (existing tests assert exact call arguments).
      if (this.retainState) {
        this.mqtt.publish(this.stateTopic, message, true);
      } else {
        this.mqtt.publish(this.stateTopic, message);
      }
    }, 250);
  }
}
