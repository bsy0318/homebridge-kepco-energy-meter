// homebridge-kepco-energy-meter/index.js
const https = require('https');
const axios = require('axios');
const KEPCOLogin = require('./playwright-kepco-login');

let Service, Characteristic, UUIDGen;

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
    
    // Display settings
    this.displayOutlet = config.displayOutlet !== undefined ? config.displayOutlet : true;
    this.displayCurrentPower = config.displayCurrentPower !== undefined ? config.displayCurrentPower : true;
    this.displayTotalEnergy = config.displayTotalEnergy !== undefined ? config.displayTotalEnergy : true;
    this.powerDisplayType = config.powerDisplayType || 'temperatureSensor'; // 기본값을 온도 센서로 변경
    this.useEveEnergyService = config.useEveEnergyService !== undefined ? config.useEveEnergyService : true;

    // Default values
    this.currentPowerConsumption = 0;
    this.totalEnergyConsumption = 0;
    this.voltage = 220; // Default value for Korea
    this.current = 0;
    this.powerFactor = 0.95; // Default power factor

    // KEPCO 로그인 모듈 초기화 (브라우저 자동화 버전)
    this.kepcoLogin = new KEPCOLogin(log);
    this.sessionInfo = null;
    this.loginRetryCount = 0;
    this.maxLoginRetries = 3;
    
    // Polling timer reference
    this.pollingTimer = null;

    // Start data polling when API is ready
    if (this.api) {
      this.api.on('didFinishLaunching', () => {
        this.log.info('KEPCO Energy Meter plugin initialized.');
        
        // Chrome 경로 설정 및 Puppeteer 환경 변수 구성
        try {
          // Puppeteer 환경 변수 설정
          process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
          process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
          
          if (!process.env.CHROME_PATH) {
            // Linux에서 일반적인 Chrome 경로
            const fs = require('fs');
            const { execSync } = require('child_process');
            
            const possiblePaths = [
              '/usr/bin/google-chrome',
              '/usr/bin/google-chrome-stable',
              '/usr/bin/chromium',
              '/usr/bin/chromium-browser',
              '/snap/bin/chromium',
              '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            ];
            
            // 시스템에서 chrome 명령어 위치 확인
            try {
              const chromePath = execSync('which google-chrome').toString().trim();
              if (chromePath && fs.existsSync(chromePath)) {
                process.env.CHROME_PATH = chromePath;
                this.log.info(`Chrome 경로를 찾았습니다 (which): ${chromePath}`);
              }
            } catch (e) {
              this.log.debug('which google-chrome 명령어 실패, 수동 검색 시도');
              
              // 수동 검색
              for (const path of possiblePaths) {
                if (fs.existsSync(path)) {
                  process.env.CHROME_PATH = path;
                  this.log.info(`Chrome 경로를 찾았습니다 (수동): ${path}`);
                  break;
                }
              }
            }
          }
          
          if (process.env.CHROME_PATH) {
            this.log.info(`사용할 Chrome 경로: ${process.env.CHROME_PATH}`);
          } else {
            this.log.warn('시스템에서 Chrome을 찾을 수 없습니다. Puppeteer의 기본 브라우저를 사용합니다.');
          }
        } catch (e) {
          this.log.error(`Chrome 경로 설정 오류: ${e.message}`);
        }
        
        this.registerAccessories();
        this.startPolling();
      });
      
      // Cleanup on shutdown
      this.api.on('shutdown', () => {
        this.stopPolling();
        if (this.sessionInfo) {
          this.kepcoLogin.cleanup(this.sessionInfo).catch(err => {
            this.log.error(`Cleanup on shutdown failed: ${err.message}`);
          });
        }
      });
    }
  }

  // Configuration sample for homebridge configuration
  static getConfigurationSample() {
    return {
      "platform": "KEPCOEnergyMeter",
      "name": "KEPCO Energy Meter",
      "userId": "고객번호_또는_한전ON_ID",
      "userPwd": "파워플래너_PW",
      "pollingInterval": 10,
      "deviceId": "kepco-energy-meter",
      "deviceName": "KEPCO Energy Meter",
      "deviceType": "energymeter",
      "displayOutlet": true,
      "displayCurrentPower": true,
      "displayTotalEnergy": true,
      "powerDisplayType": "temperatureSensor",
      "useEveEnergyService": true
    };
  }
  
  // 센서 유형에 따라 현재 전력 특성 업데이트
  updatePowerServiceCharacteristic(service) {
    if (!service) return;
    
    switch (this.powerDisplayType) {
      case 'lightSensor':
        if (service.testCharacteristic(Characteristic.CurrentAmbientLightLevel)) {
          service.updateCharacteristic(
            Characteristic.CurrentAmbientLightLevel,
            Math.max(0.0001, this.currentPowerConsumption / 1000) // lux 값 (최소 0.0001)
          );
        }
        
        // 항상 활성 상태로 표시하여 메인 화면에 표시
        if (service.testCharacteristic(Characteristic.StatusActive)) {
          service.updateCharacteristic(
            Characteristic.StatusActive,
            true
          );
        }
        
        break;
        
      case 'temperatureSensor':
        if (service.testCharacteristic(Characteristic.CurrentTemperature)) {
          service.updateCharacteristic(
            Characteristic.CurrentTemperature,
            Math.min(100, this.currentPowerConsumption / 100) // 온도 값
          );
        }
        
        // 항상 활성 상태로 표시하여 메인 화면에 표시
        if (service.testCharacteristic(Characteristic.StatusActive)) {
          service.updateCharacteristic(
            Characteristic.StatusActive,
            true
          );
        }
        
        // 오류 없음으로 표시
        if (service.testCharacteristic(Characteristic.StatusFault)) {
          service.updateCharacteristic(
            Characteristic.StatusFault,
            Characteristic.StatusFault.NO_FAULT
          );
        }
        
        break;
        
      case 'humiditySensor':
        if (service.testCharacteristic(Characteristic.CurrentRelativeHumidity)) {
          service.updateCharacteristic(
            Characteristic.CurrentRelativeHumidity,
            Math.min(100, Math.max(0, (this.currentPowerConsumption / 5000) * 100)) // 습도 값 (0-100%)
          );
        }
        
        // 항상 활성 상태로 표시하여 메인 화면에 표시
        if (service.testCharacteristic(Characteristic.StatusActive)) {
          service.updateCharacteristic(
            Characteristic.StatusActive,
            true
          );
        }
        
        break;
    }
  }

  // Start polling for power data
  startPolling() {
    this.log.debug('Starting power data polling');
    this.updatePowerData();
    
    // 기존 타이머 정리
    this.stopPolling();
    
    // Set up interval for polling
    this.pollingTimer = setInterval(() => {
      this.updatePowerData();
    }, this.pollingInterval * 60 * 1000); // Convert minutes to milliseconds
  }
  
  // Stop polling
  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
  
  // Update power data by fetching directly from KEPCO
  async updatePowerData() {
    this.log.debug('Updating power data...');
    
    try {
      // 1. 세션이 없으면 로그인
      if (!this.sessionInfo || !this.sessionInfo.sessionValid) {
        this.log.debug('No valid session, logging in to KEPCO...');
        
        try {
          // 브라우저 자동화를 통한 로그인
          this.sessionInfo = await this.kepcoLogin.login(this.userId, this.userPwd);
          // 로그인 성공 시 재시도 카운트 초기화
          this.loginRetryCount = 0;
        } catch (loginError) {
          this.loginRetryCount++;
          if (this.loginRetryCount > this.maxLoginRetries) {
            this.log.error(`Failed to login after ${this.maxLoginRetries} attempts. Will try again next cycle.`);
            this.loginRetryCount = 0;
            return;
          }
          throw loginError;
        }
      }
      
      // 2. 브라우저 자동화를 통해 전력 데이터 조회
      const data = await this.kepcoLogin.getPowerData(this.sessionInfo);
      
      // 데이터가 없거나 세션 만료인 경우
      if (!data) {
        this.log.debug('Session expired or no data returned, will login again next cycle');
        if (this.sessionInfo) {
          await this.kepcoLogin.cleanup(this.sessionInfo).catch(err => {
            this.log.error(`Session cleanup failed: ${err.message}`);
          });
        }
        this.sessionInfo = null;
        return;
      }
      
      // 3. 전력 데이터 처리
      this.processPowerData(data);
    } catch (error) {
      this.log.error(`Failed to update power data: ${error.message}`);
      // 오류 발생 시 세션 정리 및 다음 호출에서 다시 로그인
      if (this.sessionInfo) {
        await this.kepcoLogin.cleanup(this.sessionInfo).catch(err => {
          this.log.error(`Session cleanup failed: ${err.message}`);
        });
      }
      this.sessionInfo = null;
    }
  }
  
  // 현재 전력 소비량 표시 서비스 가져오기
  getCurrentPowerService(accessory) {
    // 선택된 센서 유형에 따라 다른 서비스 검색
    switch (this.powerDisplayType) {
      case 'lightSensor':
        return accessory.getService('현재 에너지 소비량') || 
               accessory.getServiceById(Service.LightSensor, 'current-power');
      case 'temperatureSensor':
        return accessory.getService('현재 에너지 소비량') || 
               accessory.getServiceById(Service.TemperatureSensor, 'current-power');
      case 'humiditySensor':
        return accessory.getService('현재 에너지 소비량') || 
               accessory.getServiceById(Service.HumiditySensor, 'current-power');
      default:
        return accessory.getService('현재 에너지 소비량') || 
               accessory.getServiceById(Service.LightSensor, 'current-power');
    }
  }
  
  // 현재 전력 소비량 서비스 추가
  addCurrentPowerService(accessory) {
    switch (this.powerDisplayType) {
      case 'lightSensor':
        return accessory.addService(Service.LightSensor, '현재 에너지 소비량', 'current-power');
      case 'temperatureSensor':
        return accessory.addService(Service.TemperatureSensor, '현재 에너지 소비량', 'current-power');
      case 'humiditySensor':
        return accessory.addService(Service.HumiditySensor, '현재 에너지 소비량', 'current-power');
      default:
        return accessory.addService(Service.LightSensor, '현재 에너지 소비량', 'current-power');
    }
  }
  
  // 현재 전력 소비량 서비스 특성 설정
  configurePowerService(service) {
    if (!service) return;
    
    switch (this.powerDisplayType) {
      case 'lightSensor':
        service.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
          .onGet(() => Math.max(0.0001, this.currentPowerConsumption / 1000)); // lux 값은 0.0001 이상이어야 함
          
        // HomeKit 메인 화면에 표시되도록 StatusActive와 StatusLowBattery 추가
        if (!service.testCharacteristic(Characteristic.StatusActive)) {
          service.addCharacteristic(Characteristic.StatusActive);
        }
        service.getCharacteristic(Characteristic.StatusActive)
          .onGet(() => true);
        
        if (!service.testCharacteristic(Characteristic.Name)) {
          service.addCharacteristic(Characteristic.Name);
        }
        service.getCharacteristic(Characteristic.Name)
          .onGet(() => '현재 에너지 소비량');
        
        break;
      case 'temperatureSensor':
        service.getCharacteristic(Characteristic.CurrentTemperature)
          .onGet(() => Math.min(100, this.currentPowerConsumption / 100)); // 온도 범위 조정
        
        // HomeKit 메인 화면에 표시되도록 StatusActive와 StatusLowBattery 추가
        if (!service.testCharacteristic(Characteristic.StatusActive)) {
          service.addCharacteristic(Characteristic.StatusActive);
        }
        service.getCharacteristic(Characteristic.StatusActive)
          .onGet(() => true);
          
        if (!service.testCharacteristic(Characteristic.StatusFault)) {
          service.addCharacteristic(Characteristic.StatusFault);
        }
        service.getCharacteristic(Characteristic.StatusFault)
          .onGet(() => Characteristic.StatusFault.NO_FAULT);
        
        break;
      case 'humiditySensor':
        service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
          .onGet(() => Math.min(100, Math.max(0, (this.currentPowerConsumption / 5000) * 100))); // 습도는 0-100%
        
        // HomeKit 메인 화면에 표시되도록 StatusActive 추가
        if (!service.testCharacteristic(Characteristic.StatusActive)) {
          service.addCharacteristic(Characteristic.StatusActive);
        }
        service.getCharacteristic(Characteristic.StatusActive)
          .onGet(() => true);
        
        break;
    }
  }
  
  // 사용하지 않는 서비스 제거
  removeUnusedServices(accessory) {
    // 콘센트 서비스
    const outletService = accessory.getService(Service.Outlet);
    if (!this.displayOutlet && outletService) {
      this.log.debug('Removing Outlet service as per configuration');
      accessory.removeService(outletService);
    }
    
    // 현재 전력 센서 서비스 (모든 가능한 유형 확인)
    if (!this.displayCurrentPower) {
      const lightService = accessory.getServiceById(Service.LightSensor, 'current-power');
      const tempService = accessory.getServiceById(Service.TemperatureSensor, 'current-power');
      const humidityService = accessory.getServiceById(Service.HumiditySensor, 'current-power');
      
      if (lightService) accessory.removeService(lightService);
      if (tempService) accessory.removeService(tempService);
      if (humidityService) accessory.removeService(humidityService);
    }
    
    // 총 에너지 센서 서비스
    const totalEnergyService = accessory.getServiceById(Service.TemperatureSensor, 'total-energy');
    if (!this.displayTotalEnergy && totalEnergyService) {
      this.log.debug('Removing Total Energy service as per configuration');
      accessory.removeService(totalEnergyService);
    }
    
    // Eve Energy 서비스
    let eveEnergyService = accessory.getService('KEPCO Energy Monitor');
    
    // UUID를 사용하여 서비스 찾기
    if (!eveEnergyService) {
      const services = accessory.services || [];
      for (const service of services) {
        if (service.UUID === ENERGY_UUID.SERVICE) {
          eveEnergyService = service;
          break;
        }
      }
    }
    if (!this.useEveEnergyService && eveEnergyService) {
      this.log.debug('Removing Eve Energy service as per configuration');
      try {
        accessory.removeService(eveEnergyService);
      } catch (e) {
        this.log.error(`Failed to remove Eve Energy service: ${e.message}`);
      }
    }
  }

  // Process the power data from KEPCO
  processPowerData(data) {
    if (!data) {
      this.log.error('No data received from KEPCO API');
      return;
    }
    
    try {
      this.log.debug(`Received data: ${JSON.stringify(data)}`);
      
      // Extract current power consumption (kWh to watts)
      if (data['실시간사용량(kWh)'] !== undefined && data['실시간사용량(kWh)'] !== null) {
        // Convert to watts - assuming this is hourly data
        this.currentPowerConsumption = parseFloat(data['실시간사용량(kWh)']) * 1000; // Convert kWh to Wh
        this.log.debug(`현재 전력 사용량: ${this.currentPowerConsumption} Wh`);
      }
      
      // Extract total energy consumption
      if (data['예상_전력사용량'] !== undefined && data['예상_전력사용량'] !== null) {
        this.totalEnergyConsumption = parseFloat(data['예상_전력사용량']);
        this.log.debug(`총 에너지 사용량: ${this.totalEnergyConsumption} kWh`);
      }
      
      // 전력량 값이 0인 경우 로그 남기기
      if (this.currentPowerConsumption <= 0 && this.totalEnergyConsumption <= 0) {
        this.log.warn('전력 사용량이 0으로 반환되었습니다. 응답 데이터를 확인하세요: ' + JSON.stringify(data));
      }
      
      // Extract power factor if available (대부분의 경우 HTML에서는 이 값을 얻기 어려울 수 있음)
      if (data['역률(지상)'] !== undefined && data['역률(지상)'] !== null) {
        this.powerFactor = parseFloat(data['역률(지상)']);
      }
      
      // Calculate current based on power and voltage (P = V * I * PF)
      // I = P / (V * PF)
      if (this.currentPowerConsumption > 0) {
        this.current = this.currentPowerConsumption / (this.voltage * this.powerFactor);
      }
      
      this.log.info(`Updated power data: ${JSON.stringify({
        currentPowerConsumption: this.currentPowerConsumption,
        totalEnergyConsumption: this.totalEnergyConsumption,
        voltage: this.voltage,
        current: this.current,
        powerFactor: this.powerFactor
      })}`);
      
      // Update all registered accessories
      this.accessories.forEach(accessory => {
        // 전력 서비스 (콘센트)
        if (this.displayOutlet) {
          const service = accessory.getService(Service.Outlet);
          if (service) {
            // 현재 전력 사용량을 On/Off 상태로 표시
            service.updateCharacteristic(
              Characteristic.On, 
              this.currentPowerConsumption > 0
            );
            
            // 현재 전력 소비량을 밝기 값으로 매핑 (0-100%)
            let brightness = Math.min(100, Math.max(0, (this.currentPowerConsumption / 5000) * 100));
            service.updateCharacteristic(
              Characteristic.Brightness, 
              brightness
            );
          }
        }
        
        // 센서 서비스 - 현재 전력 소비량을 표시
        if (this.displayCurrentPower) {
          const powerService = this.getCurrentPowerService(accessory);
          if (powerService) {
            this.updatePowerServiceCharacteristic(powerService);
          }
        }
        
        // 센서 서비스 - 총 에너지 소비량을 표시
        if (this.displayTotalEnergy) {
          const totalEnergyService = accessory.getService('예상 에너지 소비량') ||
                                    accessory.getServiceById(Service.TemperatureSensor, 'total-energy');
          if (totalEnergyService && totalEnergyService.getCharacteristic(Characteristic.CurrentTemperature)) {
            // 일부 센서는 온도 특성을 사용하여 데이터를 표시할 수 있음
            totalEnergyService.updateCharacteristic(
              Characteristic.CurrentTemperature, 
              this.totalEnergyConsumption
            );
          }
        }
        
        // Eve Energy 에너지 모니터링 서비스 업데이트
        if (this.useEveEnergyService) {
          let eveEnergyService = accessory.getService('KEPCO Energy Monitor');
          
          // UUID를 사용하여 서비스 찾기
          if (!eveEnergyService) {
            const services = accessory.services || [];
            for (const service of services) {
              if (service.UUID === ENERGY_UUID.SERVICE) {
                eveEnergyService = service;
                break;
              }
            }
          }
          
          if (eveEnergyService) {
            try {
              // On/Off 상태
              eveEnergyService.updateCharacteristic(
                Characteristic.On,
                this.currentPowerConsumption > 0
              );
              
              // 현재 전력 소비량 (와트)
              try {
                const consumption = eveEnergyService.getCharacteristic('Consumption');
                if (consumption) {
                  consumption.setValue(this.currentPowerConsumption);
                }
                
                // 총 에너지 소비량 (kWh)
                const totalConsumption = eveEnergyService.getCharacteristic('Total Consumption');
                if (totalConsumption) {
                  totalConsumption.setValue(this.totalEnergyConsumption);
                }
                
                // 전압 (볼트)
                const voltage = eveEnergyService.getCharacteristic('Voltage');
                if (voltage) {
                  voltage.setValue(this.voltage);
                }
                
                // 전류 (암페어)
                const current = eveEnergyService.getCharacteristic('Current');
                if (current) {
                  current.setValue(this.current);
                }
              } catch (charErr) {
                this.log.warn(`Error updating Eve Energy characteristics: ${charErr.message}`);
              }
            } catch (e) {
              this.log.error(`Error updating Eve Energy service: ${e.message}`);
            }
          }
        }
      });
    } catch (e) {
      this.log.error(`Error processing power data: ${e.message}`);
    }
  }

  // Configure cached accessories
  configureAccessory(accessory) {
    this.log.info('Configuring accessory %s', accessory.displayName);
    
    accessory.on('identify', () => {
      this.log.info('Identify requested for %s', accessory.displayName);
    });
    
    // 사용자 설정에 따라 서비스 추가/제거
    this.removeUnusedServices(accessory);
    
    // 콘센트 서비스 추가 (On/Off + Brightness로 전력 사용량 표시)
    let outletService = accessory.getService(Service.Outlet);
    
    if (this.displayOutlet && !outletService) {
      this.log.debug('Creating Outlet service for %s', accessory.displayName);
      outletService = accessory.addService(Service.Outlet, accessory.displayName);
      
      // 현재 전력 소비량을 밝기 특성으로 표시하기 위해 밝기 특성 추가
      outletService.addCharacteristic(Characteristic.Brightness);
    }
    
    // 현재 전력 소비량을 센서로 표시 (보조 표시)
    let powerService = this.getCurrentPowerService(accessory);
    
    if (this.displayCurrentPower && !powerService) {
      this.log.debug(`Creating ${this.powerDisplayType} service for current power`);
      powerService = this.addCurrentPowerService(accessory);
    }
    
    // 총 에너지 소비량을 온도 센서로 표시 (보조 표시)
    let totalEnergyService = accessory.getService('예상 에너지 소비량') || 
                             accessory.getServiceById(Service.TemperatureSensor, 'total-energy');
    
    if (this.displayTotalEnergy && !totalEnergyService) {
      this.log.debug('Creating Temperature Sensor service for total energy');
      totalEnergyService = accessory.addService(Service.TemperatureSensor, '예상 에너지 소비량', 'total-energy');
    }
    
    // 에너지 모니터링 서비스 추가
    let eveEnergyService = accessory.getService('KEPCO Energy Monitor');
    
    // UUID를 사용하여 서비스 찾기
    if (!eveEnergyService) {
      const services = accessory.services || [];
      for (const service of services) {
        if (service.UUID === ENERGY_UUID.SERVICE) {
          eveEnergyService = service;
          break;
        }
      }
    }
    
    if (this.useEveEnergyService && !eveEnergyService) {
      this.log.debug('Creating Eve Energy service for power monitoring');
      try {
        eveEnergyService = new Service.EveEnergyService('KEPCO Energy Monitor', 'kepco-energy');
        accessory.addService(eveEnergyService);
      } catch (e) {
        this.log.error(`Failed to create Eve Energy service: ${e.message}`);
      }
    }
    
    // On 특성 설정
    if (outletService) {
      outletService.getCharacteristic(Characteristic.On)
        .onGet(() => this.currentPowerConsumption > 0);
      
      // Brightness 특성 설정
      outletService.getCharacteristic(Characteristic.Brightness)
        .onGet(() => {
          let brightness = Math.min(100, Math.max(0, (this.currentPowerConsumption / 5000) * 100));
          return brightness;
        });
    }
    
    // 현재 전력 특성 설정
    if (powerService) {
      this.configurePowerService(powerService);
    }
    
    // TemperatureSensor(총 에너지) 특성 설정
    if (totalEnergyService) {
      totalEnergyService.getCharacteristic(Characteristic.CurrentTemperature)
        .onGet(() => this.totalEnergyConsumption);
    }
    
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
        .setCharacteristic(Characteristic.FirmwareRevision, '2.0.0');
      
      // Configure the new accessory
      this.configureAccessory(accessory);
      
      // Register the accessory
      this.api.registerPlatformAccessories('homebridge-kepco-energy-meter', 'KEPCOEnergyMeter', [accessory]);
    }
  }
}

// Eve Energy 특성 정의 - 에너지 모니터링용 커스텀 서비스
const ENERGY_UUID = {
  // Eve Energy 서비스 및 특성 UUID
  SERVICE: 'E863F007-079E-48FF-8F27-9C2605A29F52',
  CONSUMPTION: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
  VOLTAGE: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
  AMPERE: 'E863F126-079E-48FF-8F27-9C2605A29F52',
  POWER: 'E863F10D-079E-48FF-8F27-9C2605A29F52', // 수정: W로 오타 수정
  TOTAL_CONSUMPTION: 'E863F10C-079E-48FF-8F27-9C2605A29F52',
  RESET_TOTAL: 'E863F112-079E-48FF-8F27-9C2605A29F52',
  
  // Eve History 특성
  HISTORY: 'E863F116-079E-48FF-8F27-9C2605A29F52'
};

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  UUIDGen = api.hap.uuid;
  
  // Eve Energy 서비스 정의 - 전력 측정
  class EveEnergyService extends Service {
    constructor(displayName, subtype) {
      super(displayName, ENERGY_UUID.SERVICE, subtype);
      
      // 전력 측정 특성 추가
      this.addCharacteristic(Characteristic.On);
      
      // 현재 전력 특성
      this.addCharacteristic(new api.hap.Characteristic('Consumption', ENERGY_UUID.CONSUMPTION, {
        format: Characteristic.Formats.FLOAT,
        unit: 'W',
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
      }));
      
      // 총 에너지 소비량 특성
      this.addCharacteristic(new api.hap.Characteristic('Total Consumption', ENERGY_UUID.TOTAL_CONSUMPTION, {
        format: Characteristic.Formats.FLOAT,
        unit: 'kWh',
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
      }));
      
      // 전압 특성
      this.addCharacteristic(new api.hap.Characteristic('Voltage', ENERGY_UUID.VOLTAGE, {
        format: Characteristic.Formats.FLOAT,
        unit: 'V',
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
      }));
      
      // 전류 특성
      this.addCharacteristic(new api.hap.Characteristic('Current', ENERGY_UUID.AMPERE, {
        format: Characteristic.Formats.FLOAT,
        unit: 'A',
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
      }));
    }
  }
  
  // 서비스 등록
  api.hap.Service.EveEnergyService = EveEnergyService;
  
  // 플랫폼 등록
  api.registerPlatform('homebridge-kepco-energy-meter', 'KEPCOEnergyMeter', KEPCOPlatform);
};