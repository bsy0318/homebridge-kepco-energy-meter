# HomeBridge Tuya KEPCO Energy Meter Plugin

한국전력공사(KEPCO) 파워플래너 API에서 전력 사용량 데이터를 가져와 Apple HomeKit의 에너지 미터로 사용할 수 있습니다.

## 특징

- 실시간 전력 소비 데이터 표시
- 총 에너지 소비량 표시
- Apple Home 앱의 에너지 미터와 연동

## 필수 조건

- HomeBridge 설치 및 실행
- Python 3.x 설치
- 파워플래너 계정 [고객번호(또는 한전ON ID) 및 비밀번호]

## 설치 방법

1. npm을 통해 플러그인 설치:

```bash
npm install -g homebridge-tuya-kepco-energy-meter
```

2. HomeBridge에서 플러그인을 구성합니다 (아래 구성 섹션 참조).

## 구성

HomeBridge UI를 통해 구성하는 경우:

1. HomeBridge UI 설정으로 이동
2. "플러그인" 탭에서 "Tuya KEPCO Energy Meter"를 찾습니다
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
      "platform": "TuyaKEPCOEnergyMeter",
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
| `pythonPath` | Python 실행 파일 경로 | "python3" |
| `scriptPath` | Python 스크립트 경로 | 자동 생성 |


## 종속성

- Node.js 종속성:
  - child_process
  - path
  - fs

- Python 종속성 (`powerplan.py` 스크립트에 필요):
  - json
  - datetime
  - requests
  - bs4 (BeautifulSoup)
  - jsbn

## 라이센스

MIT
