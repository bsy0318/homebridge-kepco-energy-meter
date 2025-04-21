# HomeBridge KEPCO Energy Meter Plugin

한국전력공사(KEPCO) 파워플래너 API에서 전력 사용량 데이터를 가져와 Apple HomeKit의 에너지 미터로 사용할 수 있습니다.

## 특징

- 실시간 전력 소비 데이터 표시
- 총 에너지 소비량 표시
- Apple Home 앱의 에너지 미터와 연동

## 필수 조건

- HomeBridge 설치 및 실행
- 파워플래너 계정 [고객번호(또는 한전ON ID) 및 비밀번호]
- Playwright 브라우저 자동화 지원

## 설치 방법

1. HomeBridge 플러그인 디렉터리로 이동합니다:
   ```bash
   cd ~/.homebridge/node_modules/
   ```

2. 플러그인 디렉터리를 생성합니다:
   ```bash
   mkdir homebridge-kepco-energy-meter
   cd homebridge-kepco-energy-meter
   ```

3. 파일을 다운로드하거나 복사합니다:
   - `index.js`
   - `package.json`
   - `config.schema.json`
   - `ui.schema.json`

4. 파일 권한 변경:
   ```bash
   sudo chmod -R 755 /var/lib/homebridge/node_modules/homebridge-kepco-energy-meter/
   ```

5. 파일 소유권 변경:
   ```bash
   sudo chown -R homebridge:homebridge /var/lib/homebridge/node_modules/homebridge-kepco-energy-meter/
   ```

6. 의존성을 설치합니다:
   ```bash
   sudo npm install
   sudo npm link
   ```

7. Playwright 브라우저를 설치합니다:
   ```bash
   npx playwright install
   npx playwright install chrome
   ```

## 구성

HomeBridge UI를 통해 구성하는 경우:

1. HomeBridge UI 설정으로 이동
2. "플러그인" 탭에서 "KEPCO Energy Meter"를 찾습니다
3. "설정" 버튼을 클릭하여 구성 인터페이스를 엽니다
4. 필수 정보를 입력합니다:
   - 고객번호(또는 한전ON ID)
   - 한전ON 비밀번호
   - 장치 이름 및 ID
   - 원하는 폴링 간격

수동으로 `config.json` 파일을 편집하는 경우 다음을 추가하세요:

```json
{
  "platforms": [
    {
      "platform": "KEPCOEnergyMeter",
      "name": "KEPCO Energy Meter",
      "userId": "고객번호_또는_한전ON_ID",
      "userPwd": "파워플래너_PW",
      "deviceId": "kepco-energy-meter",
      "deviceName": "KEPCO Energy Meter",
      "deviceType": "energymeter",
      "pollingInterval": 10
    }
  ]
}
```

### 구성 옵션

| 옵션 | 설명 | 기본값 |
|--------|-------------|---------|
| `name` | 액세서리 이름 | "KEPCO Energy Meter" |
| `userId` | KEPCO 사용자 ID | 필수 |
| `userPwd` | KEPCO 비밀번호 | 필수 |
| `deviceId` | 장치의 고유 ID | "kepco-energy-meter" |
| `deviceName` | 장치 표시 이름 | "KEPCO Energy Meter" |
| `deviceType` | 장치 유형 | "energymeter" |
| `pollingInterval` | 데이터 업데이트 주기 (분) | 10 |
| `displayOutlet` | 콘센트로 표시 여부 | true |
| `displayCurrentPower` | 현재 전력 사용량 센서 표시 여부 | true |
| `displayTotalEnergy` | 총 에너지 사용량 센서 표시 여부 | true |
| `powerDisplayType` | 전력 표시 센서 유형 (lightSensor, temperatureSensor, humiditySensor) | temperatureSensor |
| `useEveEnergyService` | Eve Energy 호환 에너지 모니터링 사용 여부 | true |

### 표시 유형 참고사항

- `temperatureSensor`: 온도 센서 형태로 표시
- `lightSensor`: 빛 센서 형태로 표시 
- `humiditySensor`: 습도 센서 형태로 표시

## 문제 해결

문제가 발생하면 HomeBridge 로그에서 오류 메시지를 확인하세요:

1. HomeBridge UI의 로그 탭에서 확인
2. 또는 명령줄에서 HomeBridge 로그 확인:
   ```bash
   sudo journalctl -u homebridge -f
   ```

일반적인 문제:
- 잘못된 계정 정보: KEPCO 웹사이트에서 로그인이 정상적으로 되는지 확인하세요
- 네트워크 오류: 인터넷 연결 상태를 확인하세요
- 브라우저 오류: Playwright가 정상적으로 설치되었는지 확인하세요

### 브라우저 문제 해결

브라우저 자동화 관련 문제가 발생하는 경우:

1. Playwright 브라우저 재설치:
   ```bash
   cd /path/to/homebridge-kepco-energy-meter
   npx playwright install --force
   npx playwright install chrome --force
   ```

2. 시스템에 Chrome 설치:
   ```bash
   # Debian/Ubuntu
   sudo apt update && sudo apt install -y chromium-browser
   
   # Raspberry Pi OS
   sudo apt update && sudo apt install -y chromium-browser
   ```

## 종속성

- Node.js 종속성:
  - axios: HTTP 요청 처리
  - playwright: 브라우저 자동화 및 KEPCO 웹사이트 로그인 처리

## 브라우저 자동화 정보

이 플러그인은 Microsoft Playwright를 사용하여 KEPCO 파워플래너 웹사이트에 로그인하고 전력 사용량 데이터를 가져옵니다:

- 자동화된 브라우저 세션을 통한 안전한 로그인 처리
- 로그인 후 API 직접 호출 방식으로 데이터 획득
- 헤드리스 모드로 시스템 리소스를 최소화
- 자동 세션 관리 및 재접속 기능

### 자동 설치

Playwright와 필요한 브라우저 바이너리는 `npm install` 과정에서 자동으로 설치됩니다. 수동으로 설치가 필요한 경우:

```bash
npx playwright install
npx playwright install chrome
```

## 라이센스

MIT