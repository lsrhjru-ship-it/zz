// ── 전역 에러 핸들러 ──
window.onerror = function (msg, src, line, col, err) {
  console.error('[GreenStep] 전역 오류:', msg, 'at', line, col, err);
  setTimeout(() => {
    const active = document.querySelector('.screen.active');
    if (!active) {
      const ob = document.getElementById('onboarding-screen');
      if (ob) ob.classList.add('active');
    }
  }, 3000);
  return false;
};
window.onunhandledrejection = function (e) {
  console.error('[GreenStep] 미처리 Promise 오류:', e.reason);
};

// ── Capacitor / Cordova 하드웨어 만보기 및 고정형 알림창 시스템 연동 ──
document.addEventListener('deviceready', () => {
  console.log('[Native] Capacitor 하드웨어 만보기 인프라 준비 완료');

  // 1. 토스처럼 백그라운드 지속 실행 유지 서비스 활성화
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackgroundService) {
    window.Capacitor.Plugins.BackgroundService.start({
      title: 'GreenStep 만보기 작동 중',
      text: '오늘 현재 0걸음 걸었습니다.',
      smallIcon: 'ic_launcher',
      ongoing: true // 사용자가 알림창을 밀어서 끌 수 없도록 고정 (토스 방식)
    }).catch(err => console.error('백그라운드 활성화 실패:', err));
  }

  // 2. 디바이스 실제 하드웨어 센서(Pedometer) 실시간 바인딩 및 상단 알림 갱신
  if (window.plugins && window.plugins.pedometer) {
    window.plugins.pedometer.startPedometerUpdates((pedometerData) => {
      console.log('[Sensor] 하드웨어 실제 걸음수 변화 감지:', pedometerData.numberOfSteps);

      // 네이티브 센서 값을 받아 기존 상태 제어 함수와 싱크 연동
      const nativeSteps = parseInt(pedometerData.numberOfSteps, 10) || 0;

      // 기존에 구현되어 있던 내부 변수 연동부 호출
      if (nativeSteps > state.steps) {
        const diff = nativeSteps - state.steps;
        state.steps = nativeSteps;
        state.totalSteps += diff;
        state.totalDistance += diff * 0.0007;

        localStorage.setItem('gs_steps', state.steps);
        localStorage.setItem('gs_total_steps', state.totalSteps);
        localStorage.setItem('gs_total_dist', state.totalDistance);

        updatePedometerUI();
        uploadStepsToServer();
        if (typeof onStepAdded === 'function') onStepAdded();

        // 3. 상단 알림창에 실시간 걸음 수 토스 스타일로 실시간 강제 업데이트
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BackgroundService) {
          window.Capacitor.Plugins.BackgroundService.updateNotification({
            title: 'GreenStep 실시간 걸음 수',
            text: `🏃 오늘 현재 ${state.steps.toLocaleString()}걸음 걸었습니다!`
          }).catch(e => console.log('알림 갱신 지연:', e));
        }
      }
    }, (error) => {
      console.error('하드웨어 만보기 센서 접근 거부 혹은 오류:', error);
    });
  } else {
    console.warn('현재 환경에 하드웨어 Pedometer 플러그인이 누락되었거나 브라우저 환경입니다.');
  }
}, false);

// ── Android/Flutter 구형 수신 인터페이스 (하위 호환성 유지) ──
window.updateStepsFromFlutter = function (nativeSteps) {
  console.log('[Native 통신] 실시간 걸음수 수신:', nativeSteps);
  const parsedSteps = parseInt(nativeSteps, 10) || 0;

  if (parsedSteps > state.steps) {
    const diff = parsedSteps - state.steps;
    state.steps = parsedSteps;
    state.totalSteps += diff;
    state.totalDistance += diff * 0.0007;

    localStorage.setItem('gs_steps', state.steps);
    localStorage.setItem('gs_total_steps', state.totalSteps);
    localStorage.setItem('gs_total_dist', state.totalDistance);

    updatePedometerUI();
    uploadStepsToServer();
    if (typeof onStepAdded === 'function') onStepAdded();
  }
};

let state = {
  username: '',
  schoolName: '',
  schul_code: '',
  atpt_code: '',
  grade: '',
  class_num: '',
  device_id: '',
  schoolLat: 37.5665,
  schoolLng: 126.9780,
  steps: 0,
  totalSteps: 0,
  totalDistance: 0.0,
  isCommuted: false,
  commuteTime: '',
  currentRankTab: 'school'
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
  startClock();
});

const SERVER_URL = "https://lsrhjru.hidenfree.com/";
let sseSource = null;
let mapInstance = null;
let mapMarker = null;
let lastKnownCoords = null;

function initApp() {
  const cachedProfile = localStorage.getItem('GREEN_STEP_USER_PROFILE');
  const cachedSteps = localStorage.getItem('gs_steps');
  const cachedTotal = localStorage.getItem('gs_total_steps');
  const cachedDist = localStorage.getItem('gs_total_dist');
  const cachedCommute = localStorage.getItem('gs_commute_state');

  if (cachedSteps) state.steps = parseInt(cachedSteps, 10);
  if (cachedTotal) state.totalSteps = parseInt(cachedTotal, 10);
  if (cachedDist) state.totalDistance = parseFloat(cachedDist);

  if (cachedCommute) {
    const p = JSON.parse(cachedCommute);
    const todayStr = new Date().toDateString();
    if (p.date === todayStr) {
      state.isCommuted = p.isCommuted;
      state.commuteTime = p.commuteTime;
    }
  }

  if (cachedProfile) {
    const p = JSON.parse(cachedProfile);
    Object.assign(state, p);
    enterMainScreen();
  } else {
    switchScreen('onboarding-screen');
  }
  updatePedometerUI();
}

function switchScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

function enterMainScreen() {
  switchScreen('main-screen');
  document.getElementById('display-school').innerText = state.schoolName || '학교 정보 없음';
  document.getElementById('display-user-info').innerText = `${state.grade || '-'}학년 ${state.class_num || '-'}반 · ${state.username || '미등록'}`;

  initKakaoMap();
  initGPSWatch();
  loadMealInfo();
  connectSSE();
  loadRankData();
}

function setupEventListeners() {
  const btnEdit = document.getElementById('btn-edit-profile');
  const btnReset = document.getElementById('btn-reset');
  const btnCommute = document.getElementById('btn-commute');

  if (btnEdit) {
    btnEdit.addEventListener('click', () => {
      openProfileModalDirect();
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('모든 로컬 데이터와 설정을 리셋하고 처음으로 돌아갑니까?')) {
        localStorage.clear();
        location.reload();
      }
    });
  }

  if (btnCommute) {
    btnCommute.addEventListener('click', () => {
      if (!lastKnownCoords) return alert('GPS 신호 분석 중입니다.');
      const lat1 = lastKnownCoords.latitude; const lng1 = lastKnownCoords.longitude;
      const lat2 = state.schoolLat; const lng2 = state.schoolLng;

      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180; const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const distMeter = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      if (distMeter > 300) return alert(`학교 반경 300m 이내만 등교 인증이 가능합니다. (현재 거리: ${Math.round(distMeter)}m)`);

      const now = new Date();
      state.isCommuted = true;
      state.commuteTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      localStorage.setItem('gs_commute_state', JSON.stringify({
        date: now.toDateString(),
        isCommuted: true,
        commuteTime: state.commuteTime
      }));

      updatePedometerUI();
      uploadStepsToServer();
      showSystemPopup('🌲 등교 인증 완료', `학교 도달 성공! (${state.commuteTime} 인증됨) 에코 포인트 가산 완료.`);
    });
  }

  window.addEventListener('online', () => document.getElementById('offline-toast-bar').classList.add('hidden'));
  window.addEventListener('offline', () => document.getElementById('offline-toast-bar').classList.remove('hidden'));
}

function updatePedometerUI() {
  const counter = document.getElementById('step-counter');
  const progress = document.getElementById('step-progress');
  const distEl = document.getElementById('stat-dist');
  const calEl = document.getElementById('stat-cal');
  const lvlEl = document.getElementById('display-level');
  const cBadge = document.getElementById('commute-badge');
  const btnCommute = document.getElementById('btn-commute');

  if (counter) counter.innerText = state.steps.toLocaleString();
  if (distEl) distEl.innerText = `${state.totalDistance.toFixed(2)} km`;

  const kcal = Math.round(state.steps * 0.04);
  if (calEl) calEl.innerText = `${kcal} kcal`;

  if (progress) {
    const pct = Math.min(100, (state.steps / 2000) * 100);
    progress.style.width = `${pct}%`;
  }

  if (lvlEl) {
    if (state.totalSteps < 5000) lvlEl.innerText = "Lv.1 씨앗🫘";
    else if (state.totalSteps < 15000) lvlEl.innerText = "Lv.2 새싹🌱";
    else if (state.totalSteps < 40000) lvlEl.innerText = "Lv.3 꽃봉오리🌷";
    else lvlEl.innerText = "Lv.4 울창한 나무🌳";
  }

  if (cBadge && btnCommute) {
    if (state.isCommuted) {
      cBadge.innerText = `등교 완료 (${state.commuteTime})`;
      btnCommute.className = "font-bold bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-lg text-xs pointer-events-none";
    } else {
      cBadge.innerText = "등교 미인증";
      btnCommute.className = "font-bold bg-amber-400 text-slate-900 px-2.5 py-0.5 rounded-lg shadow-sm text-xs active:scale-95 transition-all";
    }
  }
}

function openProfileModalDirect() {
  const modal = document.getElementById('profile-modal');
  const sheet = document.getElementById('profile-sheet');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => {
    sheet.classList.remove('translate-y-full');
  }, 50);

  const gradeSel = document.getElementById('input-grade');
  if (gradeSel && gradeSel.children.length === 0) {
    for (let i = 1; i <= 3; i++) {
      gradeSel.innerHTML += `<option value="${i}">${i}학년</option>`;
    }
    loadClassList();
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  const sheet = document.getElementById('profile-sheet');
  sheet.classList.add('translate-y-full');
  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }, 300);
}

async function searchSchool() {
  const keyword = document.getElementById('input-school-search').value.trim();
  if (!keyword) return alert('검색할 학교명을 입력하세요.');
  const resBox = document.getElementById('school-search-results');
  resBox.innerHTML = '<p class="p-3 text-slate-400 animate-pulse">전국 교육청 데이터 허브 연동 중...</p>';
  resBox.classList.remove('hidden');

  try {
    const response = await fetch(`${SERVER_URL}/api/neis/school?keyword=${encodeURIComponent(keyword)}`);
    const data = await response.json();
    resBox.innerHTML = '';
    if (!data.schools || data.schools.length === 0) {
      resBox.innerHTML = '<p class="p-3 text-rose-500 font-semibold">검색 결과가 없습니다.</p>';
      return;
    }
    data.schools.forEach(sch => {
      const div = document.createElement('div');
      div.className = "p-3 hover:bg-emerald-50 cursor-pointer transition-all font-semibold text-slate-700";
      div.innerText = `[${sch.atpt_name}] ${sch.schul_name}`;
      div.addEventListener('click', () => {
        state.schoolName = sch.schul_name;
        state.schul_code = sch.schul_code;
        state.atpt_code = sch.atpt_code;
        state.schoolLat = parseFloat(sch.lat) || 37.5665;
        state.schoolLng = parseFloat(sch.lng) || 126.9780;
        document.getElementById('input-school-search').value = sch.schul_name;
        resBox.classList.add('hidden');
        loadClassList();
      });
      resBox.appendChild(div);
    });
  } catch (e) {
    resBox.innerHTML = '<p class="p-3 text-rose-500">네트워크 연동 실패</p>';
  }
}

async function loadClassList() {
  const grade = document.getElementById('input-grade').value;
  const classSel = document.getElementById('input-class');
  if (!state.schul_code) return;
  try {
    const res = await fetch(`${SERVER_URL}/api/neis/classes?atpt_code=${state.atpt_code}&schul_code=${state.schul_code}&grade=${grade}&year=2026`);
    const data = await res.json();
    classSel.innerHTML = '';
    if (!data.classList || data.classList.length === 0) {
      for (let i = 1; i <= 12; i++) classSel.innerHTML += `<option value="${i}">${i}반</option>`;
      return;
    }
    data.classList.forEach(cName => { classSel.innerHTML += `<option value="${cName}">${cName}반</option>`; });
  } catch (e) { classSel.innerHTML = '<option value="1">1반</option>'; }
}

async function saveProfile() {
  const nameInput = document.getElementById('input-username').value.trim();
  if (!nameInput || !state.schul_code) return alert('성명과 학교를 지정해야 동기화가 가능합니다.');

  state.username = nameInput;
  state.grade = document.getElementById('input-grade').value;
  state.class_num = document.getElementById('input-class').value;
  state.device_id = `USR_${state.schul_code}_${state.grade}_${state.class_num}_${encodeURIComponent(state.username)}`;

  localStorage.setItem('GREEN_STEP_USER_PROFILE', JSON.stringify(state));
  closeProfileModal();

  try {
    await fetch(`${SERVER_URL}/api/user/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
  } catch (e) { console.error(e); }

  enterMainScreen();
}

function initKakaoMap() {
  const container = document.getElementById('map-container');
  if (!container || !window.kakao || !window.kakao.maps) return;
  document.getElementById('map-overlay').remove();

  const loc = new kakao.maps.LatLng(state.schoolLat, state.schoolLng);
  mapInstance = new kakao.maps.Map(container, { center: loc, level: 4 });
  mapMarker = new kakao.maps.Marker({ position: loc, map: mapInstance });

  const circle = new kakao.maps.Circle({
    center: loc,
    radius: 300,
    strokeWeight: 2,
    strokeColor: '#059669',
    strokeOpacity: 0.6,
    fillColor: '#10B981',
    fillOpacity: 0.15
  });
  circle.setMap(mapInstance);
}

function initGPSWatch() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(pos => {
    lastKnownCoords = pos.coords;
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    document.getElementById('geo-log').innerText = `GPS 수신 정상 (위도: ${lat.toFixed(4)}, 경도: ${lng.toFixed(4)})`;

    if (mapInstance) {
      const currentLoc = new kakao.maps.LatLng(lat, lng);
      mapInstance.setCenter(currentLoc);
    }
    updateWeatherComment(lat, lng);
  }, err => {
    document.getElementById('geo-log').innerText = `GPS 장치 응답 불량 (실내 또는 권한 거부)`;
  }, { enableHighAccuracy: true });
}

async function updateWeatherComment(lat, lng) {
  try {
    const res = await fetch(`${SERVER_URL}/api/weather/radar?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    document.getElementById('weather-status-text').innerText = data.skyStatus || '정보 없음';
    document.getElementById('weather-temp').innerText = data.temp || '--';
    document.getElementById('weather-comment').innerText = data.comment || '기상 분석 데이터 스트리밍 정상 작동 중.';
  } catch (e) {
    document.getElementById('weather-status-text').innerText = "통신 제한";
  }
}

async function loadMealInfo() {
  const container = document.getElementById('meal-container');
  const calBox = document.getElementById('meal-calories');
  try {
    const res = await fetch(`${SERVER_URL}/api/neis/meal?atpt_code=${state.atpt_code}&schul_code=${state.schul_code}`);
    const data = await res.json();
    if (!data.dish || data.dish.length === 0) {
      container.innerHTML = '<p class="text-slate-400 text-xs py-4">오늘 구성된 급식 식단표가 없습니다.</p>';
      return;
    }
    calBox.innerHTML = `<span class="bg-emerald-50 text-emerald-600 border border-emerald-200/50 px-3 py-1 rounded-full">${data.calories || '0 kcal'}</span>`;
    container.innerHTML = `<div class="text-xs font-bold text-slate-700 leading-relaxed break-keep grid grid-cols-2 gap-2">${data.dish.map(d => `<span class="bg-white p-2 rounded-xl border border-slate-100 shadow-3xs">${d}</span>`).join('')}</div>`;
  } catch (e) {
    container.innerHTML = '<p class="text-rose-400 text-xs py-4">급식 정보 서브시스템 응답 장애</p>';
  }
}

function connectSSE() {
  if (sseSource) sseSource.close();
  sseSource = new EventSource(`${SERVER_URL}/api/stream/cheers?schul_code=${state.schul_code}&grade=${state.grade}&class_num=${state.class_num}`);
  sseSource.onmessage = function (event) {
    const data = JSON.parse(event.data);
    const container = document.getElementById('cheers-container');
    container.innerHTML = '';
    if (!data.messages || data.messages.length === 0) {
      container.innerHTML = '<p class="text-slate-400 text-xs text-center py-6">학급 친구들과 첫 응원을 나눠보세요!</p>';
      return;
    }
    data.messages.forEach(m => {
      container.innerHTML += `
        <div class="flex flex-col bg-slate-50 p-3 rounded-xl border border-slate-100/70 space-y-0.5 fade-in">
          <span class="text-[10px] font-black text-slate-400">${m.username}</span>
          <p class="text-xs font-semibold text-slate-700 break-all">${m.content}</p>
        </div>`;
    });
    container.scrollTop = container.scrollHeight;
  };
}

async function submitCheerMessage() {
  const input = document.getElementById('input-cheer-content');
  const txt = input.value.trim();
  if (!txt) return;
  input.value = '';
  try {
    await fetch(`${SERVER_URL}/api/cheers/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schul_code: state.schul_code,
        grade: state.grade,
        class_num: state.class_num,
        username: state.username,
        content: txt
      })
    });
  } catch (e) { alert('메시지 전송 실패'); }
}

async function uploadStepsToServer() {
  if (!state.device_id) return;
  try {
    await fetch(`${SERVER_URL}/api/user/sync-steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: state.device_id,
        steps: state.steps,
        totalSteps: state.totalSteps,
        totalDistance: state.totalDistance,
        isCommuted: state.isCommuted,
        commuteTime: state.commuteTime
      })
    });
    loadRankData();
  } catch (e) { console.error('서버 동기화 일시 지연'); }
}

function switchRankTab(type) {
  state.currentRankTab = type;
  document.querySelectorAll('[id^="rank-tab-"]').forEach(b => {
    b.className = "flex-1 py-2 text-center rounded-lg transition-all duration-200";
  });
  const act = document.getElementById(`rank-tab-${type}`);
  if (act) act.className = "flex-1 py-2 text-center rounded-lg bg-white text-slate-900 shadow-sm font-black";
  loadRankData();
}

async function loadRankData() {
  if (!state.schul_code) return;
  const listEl = document.getElementById('ranking-list');
  try {
    const res = await fetch(`${SERVER_URL}/api/rank?type=${state.currentRankTab}&schul_code=${state.schul_code}&grade=${state.grade}&class_num=${state.class_num}`);
    const data = await res.json();
    listEl.innerHTML = '';

    if (!data.rankings || data.rankings.length === 0) {
      listEl.innerHTML = '<p class="text-slate-400 text-xs text-center py-6">집계된 랭킹 데이터가 없습니다.</p>';
      return;
    }

    let myRankStr = "권외";
    data.rankings.forEach((r, idx) => {
      const isMe = r.device_id === state.device_id;
      if (isMe) myRankStr = `${idx + 1}위`;

      let rankBadge = `<span class="w-5 h-5 text-[11px] font-black flex items-center justify-center text-slate-400">${idx + 1}</span>`;
      if (idx === 0) rankBadge = `<span class="w-5 h-5 bg-amber-400 text-amber-900 rounded-full text-[10px] font-black flex items-center justify-center shadow-xs">1</span>`;
      if (idx === 1) rankBadge = `<span class="w-5 h-5 bg-slate-300 text-slate-800 rounded-full text-[10px] font-black flex items-center justify-center shadow-xs">2</span>`;
      if (idx === 2) rankBadge = `<span class="w-5 h-5 bg-amber-600 text-amber-50 rounded-full text-[10px] font-black flex items-center justify-center shadow-xs">3</span>`;

      listEl.innerHTML += `
        <div class="flex justify-between items-center p-3.5 rounded-2xl border ${isMe ? 'bg-emerald-50/70 border-emerald-200 shadow-sm' : 'bg-slate-50/50 border-slate-100'} transition-all">
          <div class="flex items-center space-x-3">
            ${rankBadge}
            <div class="flex flex-col">
              <span class="text-xs font-bold text-slate-800">${r.username} ${isMe ? '<span class="text-[9px] text-emerald-600 bg-emerald-100 px-1.5 py-0.2 rounded-md ml-1">나</span>' : ''}</span>
              <span class="text-[9px] font-medium text-slate-400">${r.schoolName} · ${r.grade}학년</span>
            </div>
          </div>
          <span class="text-xs font-black text-slate-700 tracking-tight">${parseInt(r.steps, 10).toLocaleString()}보</span>
        </div>`;
    });

    document.getElementById('my-rank-badge').innerText = `내 순위: ${myRankStr}`;
  } catch (e) {
    listEl.innerHTML = '<p class="text-slate-400 text-xs text-center py-6">랭킹 분석 시스템 응답 거부</p>';
  }
}

async function submitFeedback() {
  const tInput = document.getElementById('input-feedback-title');
  const cInput = document.getElementById('input-feedback-content');
  const title = tInput.value.trim();
  const content = cInput.value.trim();

  if (!title || !content) return alert('제목과 피드백 상세 내용을 모두 기입해 주세요.');

  try {
    await fetch(`${SERVER_URL}/api/feedback/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: state.device_id || "GUEST_ANONYMOUS",
        username: state.username || "익명",
        title: title,
        content: content
      })
    });
    alert('제출 성공! 개발팀에 전송되었습니다.');
    tInput.value = '';
    cInput.value = '';
  } catch (e) { alert('서버 전송 장애'); }
}

function showSystemPopup(title, content) {
  const modal = document.getElementById('system-popup-modal');
  const card = document.getElementById('system-popup-card');
  document.getElementById('popup-title').innerText = title;
  document.getElementById('popup-content').innerText = content;

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => {
    modal.classList.add('opacity-100');
    card.classList.remove('scale-95');
    card.classList.add('scale-100');
  }, 50);
}

function closeSystemPopup() {
  const modal = document.getElementById('system-popup-modal');
  const card = document.getElementById('system-popup-card');

  modal.classList.remove('opacity-100');
  card.classList.remove('scale-100');
  card.classList.add('scale-95');

  setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }, 300);
}

function startClock() {
  setInterval(() => {
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    document.getElementById('live-date').innerText = `${now.getFullYear()}년 ${String(now.getMonth() + 1).padStart(2, '0')}월 ${String(now.getDate()).padStart(2, '0')}일 ${days[now.getDay()]}요일`;
    document.getElementById('live-time').innerText = now.toTimeString().split(' ')[0];
  }, 1000);
}

// ── 나이스 주간 시간표 모달 기능 (기존 로직 유지) ──
function openTimetableModal() {
  const modal = document.getElementById('timetable-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  loadTimetableData();
}

document.getElementById('timetable-modal-close').addEventListener('click', () => {
  const modal = document.getElementById('timetable-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
});

async function loadTimetableData() {
  const grid = document.getElementById('timetable-grid');
  if (!state.schul_code) {
    grid.innerHTML = '<p class="text-xs text-rose-500 text-center py-4">학교 정보를 먼저 등록하세요.</p>';
    return;
  }
  try {
    const res = await fetch(`${SERVER_URL}/api/neis/timetable?atpt_code=${state.atpt_code}&schul_code=${state.schul_code}&grade=${state.grade}&class_num=${state.class_num}`);
    const data = await res.json();
    grid.innerHTML = '';
    if (!data.timetable || data.timetable.length === 0) {
      grid.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">오늘 배정된 정규 교과 수업이 없습니다.</p>';
      return;
    }
    data.timetable.forEach(t => {
      grid.innerHTML += `
        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
          <span class="text-xs font-black text-emerald-600">${t.perio}교시</span>
          <span class="text-xs font-bold text-slate-700">${t.itrt_cntnt}</span>
        </div>`;
    });
  } catch (e) {
    grid.innerHTML = '<p class="text-xs text-rose-400 text-center py-4">시간표 동기화 인프라 응답 에러</p>';
  }
}