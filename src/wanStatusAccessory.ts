import { AccessoryPlugin, API, CharacteristicValue, Logger, Service } from 'homebridge';

export class WanStatusAccessory implements AccessoryPlugin {
  private readonly service: Service;
  private readonly info: Service;
  private online = true;

  constructor(private readonly log: Logger, private readonly api: API, public readonly name: string) {
    const { Service: S, Characteristic: C } = api.hap;
    this.service = new S.ContactSensor(name);
    this.service.getCharacteristic(C.ContactSensorState).onGet(() => this.state());
    this.info = new S.AccessoryInformation()
      .setCharacteristic(C.Manufacturer, 'Ubiquiti')
      .setCharacteristic(C.Model, 'WAN Status Sensor')
      .setCharacteristic(C.SerialNumber, 'unifi-wan-status');
  }

  private state(): CharacteristicValue {
    const S = this.api.hap.Characteristic.ContactSensorState;
    return this.online ? S.CONTACT_DETECTED : S.CONTACT_NOT_DETECTED;
  }

  getServices(): Service[] {
    return [this.info, this.service];
  }

  updateStatus(online: boolean): void {
    this.online = online;
    this.service.updateCharacteristic(this.api.hap.Characteristic.ContactSensorState, this.state());
    this.log.debug(`${this.name}: WAN ${online ? 'online' : 'offline'}`);
  }
}
