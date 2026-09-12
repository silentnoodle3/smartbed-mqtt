import { logError, logInfo } from '@utils/logger';
import EventEmitter from 'events';
import { MqttClient } from 'mqtt';
import { IMQTTConnection } from './IMQTTConnection';

export class MQTTConnection extends EventEmitter implements IMQTTConnection {
  private subscribedTopics: string[] = [];

  constructor(private client: MqttClient) {
    super();

    client.on('connect', () => {
      logInfo('[MQTT] Connected');
      this.emit('connect');
    });

    client.on('reconnect', () => {
      logInfo('[MQTT] Reconnecting...');
    });

    client.on('disconnect', client.removeAllListeners);

    client.on('error', (error) => {
      logError('[MQTT] Error', error);
    });

    client.on('message', (topic, message) => {
      this.emit(topic, message.toString());
    });
    this.setMaxListeners(0);
  }

  publish(topic: string, message: any, retain: boolean = false) {
    if (message instanceof Object) {
      message = JSON.stringify(message);
    } else if (typeof message !== 'string' && !(message instanceof Buffer)) {
      // A primitive number/boolean/etc isn't `instanceof Object`, so it would
      // otherwise reach the mqtt client unstringified and throw ERR_INVALID_ARG_TYPE
      // (it requires a string or Buffer payload) - crashing the whole add-on, not
      // just this one publish call, since that's an uncaught exception. Found via
      // Reverie's position sensors, worked around locally there, fixed properly here.
      message = String(message);
    }
    this.client.publish(topic, message, { qos: 1, retain });
  }

  subscribe(topic: string) {
    if (!this.subscribedTopics.includes(topic)) {
      this.client.subscribe(topic);
      this.subscribedTopics.push(topic);
    }
  }

  unsubscribe(topic: string) {
    const index = this.subscribedTopics.indexOf(topic);
    if (index !== -1) {
      this.client.unsubscribe(topic);
      this.subscribedTopics.splice(index, 1);
    }
  }
}
