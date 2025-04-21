// homebridge-kepco-energy-meter/index.js
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let Service, Characteristic;

class KEPCOPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    // Configuration
    this.name = config.name || 'KEPCO Energy Meter';
    this.userId = config.userId;
    this.userPwd = config.userPwd;
    this.pollingInterval = config.pollingInterval || 10; // minutes
    this.pythonPath = config.pythonPath || 'python3';
    this.scriptPath = config.scriptPath || path.join(__dirname, 'fetch_power_data.py');

    // Default values
    this.currentPowerConsumption = 0;
    this.totalEnergyConsumption = 0;
    this.voltage = 220; // Default value for Korea
    this.current = 0;
    this.powerFactor = 0.95; // Default power factor

    // Create the Python script during initialization
    this.createFetchScript();

    // Start data polling when API is ready
    if (this.api) {
      this.api.on('didFinishLaunching', () => {
        this.startPolling();
      });
    }
  }

  // Configuration sample for homebridge-tuya-platform compatibility
  static getConfigurationSample() {
    return {
      "platform": "KEPCOEnergyMeter",
      "name": "KEPCO Energy Meter",
      "userId": "고객번호_또는_한전ON_ID",
      "userPwd": "파워플래너_PW",
      "pollingInterval": 10,
      "deviceId": "kepco-energy-meter",
      "deviceName": "KEPCO Energy Meter",
      "deviceType": "energymeter"
    };
  }

  // Start polling for power data
  startPolling() {
    this.log.debug('Starting power data polling');
    this.updatePowerData();
    
    // Set up interval for polling
    setInterval(() => {
      this.updatePowerData();
    }, this.pollingInterval * 60 * 1000); // Convert minutes to milliseconds
  }
  
  // Update power data by calling the Python script
  updatePowerData() {
    this.log.debug('Updating power data...');
    
    const command = `${this.pythonPath} ${this.scriptPath} ${this.userId} ${this.userPwd}`;
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        this.log.error(`Error executing Python script: ${error.message}`);
        return;
      }
      
      if (stderr) {
        this.log.error(`Python script error: ${stderr}`);
        return;
      }
      
      try {
        const data = JSON.parse(stdout);
        this.processPowerData(data);
      } catch (e) {
        this.log.error(`Error parsing Python output: ${e.message}`);
      }
    });
  }
  
  // Process the power data from the Python script
  processPowerData(data) {
    if (!data) {
      this.log.error('No data received from Python script');
      return;
    }
    
    try {
      // Extract current power consumption (kWh to watts)
      if (data.F_AP_QT || data['실시간사용량(kWh)']) {
        const kWh = data.F_AP_QT || data['실시간사용량(kWh)'];
        // Convert to watts - assuming this is hourly data
        this.currentPowerConsumption = kWh * 1000; // Convert kWh to Wh
      }
      
      // Extract total energy consumption
      if (data.PREDICT_TOT || data['예상_전력사용량']) {
        this.totalEnergyConsumption = data.PREDICT_TOT || data['예상_전력사용량'];
      }
      
      // Extract power factor if available
      if (data.F_LARAP_PF || data['역률(지상)']) {
        this.powerFactor = data.F_LARAP_PF || data['역률(지상)'];
      }
      
      // Calculate current based on power and voltage (P = V * I * PF)
      // I = P / (V * PF)
      if (this.currentPowerConsumption > 0) {
        this.current = this.currentPowerConsumption / (this.voltage * this.powerFactor);
      }
      
      this.log.debug(`Updated power data: ${JSON.stringify({
        currentPowerConsumption: this.currentPowerConsumption,
        totalEnergyConsumption: this.totalEnergyConsumption,
        voltage: this.voltage,
        current: this.current,
        powerFactor: this.powerFactor
      })}`);
      
      // Update all registered accessories
      this.accessories.forEach(accessory => {
        const service = accessory.getService(Service.PowerMeterService);
        if (service) {
          service.updateCharacteristic(
            Characteristic.CurrentPowerConsumption, 
            this.currentPowerConsumption
          );
          
          service.updateCharacteristic(
            Characteristic.TotalEnergyConsumption, 
            this.totalEnergyConsumption
          );
          
          service.updateCharacteristic(
            Characteristic.Voltage, 
            this.voltage
          );
          
          service.updateCharacteristic(
            Characteristic.ElectricCurrent, 
            this.current
          );
          
          service.updateCharacteristic(
            Characteristic.PowerFactor, 
            this.powerFactor
          );
        }
      });
    } catch (e) {
      this.log.error(`Error processing power data: ${e.message}`);
    }
  }
  
  // Create the Python script to fetch data
  createFetchScript() {
    // Path where the script will be created
    const scriptPath = this.scriptPath;
    
    // Python script content
    const scriptContent = `
import sys
import json
import os
import importlib.util
from datetime import datetime

def main():
    if len(sys.argv) < 3:
        print("Usage: python fetch_power_data.py <user_id> <user_pwd> [date]", file=sys.stderr)
        sys.exit(1)
    
    # Get command line arguments
    user_id = sys.argv[1]
    user_pwd = sys.argv[2]
    
    # Optional date parameter (YYYY-MM-DD)
    if len(sys.argv) > 3:
        date = sys.argv[3]
    else:
        date = datetime.now().strftime('%Y-%m-%d')
    
    # Get the path to the powerplan.py module
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    # First try to find powerplan.py in the same directory
    powerplan_path = os.path.join(current_dir, 'powerplan.py')
    
    # If not found, try the parent directory
    if not os.path.exists(powerplan_path):
        parent_dir = os.path.dirname(current_dir)
        powerplan_path = os.path.join(parent_dir, 'powerplan.py')
    
    # If still not found, look in sibling directories
    if not os.path.exists(powerplan_path):
        parent_dir = os.path.dirname(current_dir)
        for sibling in os.listdir(parent_dir):
            sibling_path = os.path.join(parent_dir, sibling)
            if os.path.isdir(sibling_path):
                potential_path = os.path.join(sibling_path, 'powerplan.py')
                if os.path.exists(potential_path):
                    powerplan_path = potential_path
                    break
    
    # If still not found, exit with error
    if not os.path.exists(powerplan_path):
        print(f"Error: Could not find powerplan.py", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Load the powerplan module
        spec = importlib.util.spec_from_file_location("powerplan", powerplan_path)
        powerplan = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(powerplan)
        
        # Fetch power data
        data = powerplan.scraping(user_id, user_pwd, scrap_date=date, simple=True)
        
        # Print the data as JSON
        print(json.dumps(data))
        
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
`;

    fs.writeFileSync(scriptPath, scriptContent);
    this.log.info(`Created Python script: ${scriptPath}`);
  }

  // Configure cached accessories
  configureAccessory(accessory) {
    this.log.info('Configuring accessory %s', accessory.displayName);
    
    accessory.on('identify', () => {
      this.log.info('Identify requested for %s', accessory.displayName);
    });
    
    // Get the service if it exists
    let service = accessory.getService(Service.PowerMeterService);
    
    // Create the service if it doesn't exist
    if (!service) {
      this.log.debug('Creating PowerMeterService for %s', accessory.displayName);
      service = accessory.addService(Service.PowerMeterService, accessory.displayName);
    }
    
    // Configure characteristics
    service.getCharacteristic(Characteristic.CurrentPowerConsumption)
      .onGet(() => this.currentPowerConsumption);
    
    service.getCharacteristic(Characteristic.TotalEnergyConsumption)
      .onGet(() => this.totalEnergyConsumption);
    
    service.getCharacteristic(Characteristic.Voltage)
      .onGet(() => this.voltage);
    
    service.getCharacteristic(Characteristic.ElectricCurrent)
      .onGet(() => this.current);
    
    service.getCharacteristic(Characteristic.PowerFactor)
      .onGet(() => this.powerFactor);
    
    // Add to the array of accessories
    this.accessories.push(accessory);
  }
  
  // Register new accessories
  registerAccessories() {
    const uuid = this.api.hap.uuid.generate('homebridge-kepco-energy-meter');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    
    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      this.configureAccessory(existingAccessory);
    } else {
      this.log.info('Adding new accessory:', this.name);
      
      const accessory = new this.api.platformAccessory(this.name, uuid);
      
      // Set device information
      accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, 'KEPCO')
        .setCharacteristic(Characteristic.Model, 'Energy Meter')
        .setCharacteristic(Characteristic.SerialNumber, 'KEPCO-001')
        .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0');
      
      // Configure the new accessory
      this.configureAccessory(accessory);
      
      // Register the accessory
      this.api.registerPlatformAccessories('homebridge-kepco-energy-meter', 'KEPCOEnergyMeter', [accessory]);
    }
  }
}

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  
  api.registerPlatform('homebridge-kepco-energy-meter', 'KEPCOEnergyMeter', KEPCOPlatform);
};