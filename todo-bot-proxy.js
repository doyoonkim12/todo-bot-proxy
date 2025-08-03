const express = require('express');
const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');
const schedule = require('node-schedule');

// 한국 시간대 설정
process.env.TZ = 'Asia/Seoul';

const TELEGRAM_BOT_TOKEN = '8023958323:AAG1p9qnMEal2GuH-bsyuT-GRKWpXXUU12c';
const CHAT_ID = '-4851514209';
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

const app = express();

// CORS 허용
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.text({ type: 'text/plain' }));
app.use(express.json());

const GAS_URL = 'https://script.google.com/macros/s/AKfycbyr_lN2QblIPP_PQF9wLF5Gs9s7AFbWTXDvMQQ_AySdiAOxlrE6TMItmsvDMRTxHh-6/exec';

// 자동 알림 스케줄러
// 매일 오전 11시 - 오늘 할일 알림
schedule.scheduleJob('0 11 * * *', async () => {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`🕚 [${now}] 오전 11시 - 오늘 할일 자동 알림 시작`);
  await sendDailyTodoReminder();
});

// 매 1분마다 - 시간별 알림 체크 (더 정확한 알림을 위해)
schedule.scheduleJob('* * * * *', async () => {
  await checkTimeBasedReminders();
});

// 스케줄러 상태 확인용 (매 10분마다)
schedule.scheduleJob('*/10 * * * *', () => {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  console.log(`⏰ [${now}] 할일 봇 스케줄러 작동 중...`);
});

// GAS API 호출 함수
async function callGAS(func, params = {}) {
  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ func, params }),
      timeout: 30000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    if (!text || text.trim() === '') {
      throw new Error('서버에서 빈 응답을 받았습니다');
    }

    const result = JSON.parse(text);
    return result;
  } catch (error) {
    console.error('❌ GAS API 호출 오류:', error);
    throw error;
  }
}

// 오늘 할일 알림 전송
async function sendDailyTodoReminder() {
  try {
    const result = await callGAS('sendDailyTodoReminder', {});
    if (result && result.success) {
      console.log('✅ 오늘 할일 알림 전송 성공');
    } else {
      console.error('❌ 오늘 할일 알림 전송 실패:', result && result.message);
    }
  } catch (err) {
    console.error('❌ 오늘 할일 알림 전송 중 오류:', err);
  }
}

// 알림 중복 방지용 Map
const sentReminders = new Map();

// 시간별 알림 체크
async function checkTimeBasedReminders() {
  try {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes(); // 현재 시간을 분으로 변환
    const timeKey = `${now.getHours()}:${now.getMinutes()}`;
    
    console.log(`🔍 [${now.toLocaleString('ko-KR')}] 시간별 알림 체크 시작 - 현재 시간: ${currentTime}분`);
    
    // 오늘 할일 목록 가져오기
    const result = await callGAS('getTodoListForReminders', {});
    if (!result || !result.success || !result.data) {
      console.log('📝 오늘 할일이 없거나 조회 실패');
      return;
    }
    
    const todos = result.data;
    console.log(`📋 오늘 할일 ${todos.length}개 확인됨`);
    
    todos.forEach(todo => {
      const todoTime = parseTimeToMinutes(todo.time);
      const timeDiff = todoTime - currentTime;
      
      console.log(`⏰ 할일: "${todo.task}" - 예정시간: ${todo.time}(${todoTime}분), 차이: ${timeDiff}분`);
      
      // 알림 시간 체크 (1시간전, 30분전, 10분전, 5분전, 정시)
      const reminderTimes = [60, 30, 10, 5, 0];
      
      reminderTimes.forEach(reminderTime => {
        // 정확한 시간이거나 1분 이내 오차 허용
        if (Math.abs(timeDiff - reminderTime) <= 1) {
          const reminderKey = `${todo.task}_${reminderTime}_${now.toDateString()}`;
          
          // 중복 알림 방지
          if (!sentReminders.has(reminderKey)) {
            console.log(`🔔 알림 전송: "${todo.task}" ${reminderTime}분 전 알림`);
            sendTimeBasedReminder(todo, reminderTime);
            sentReminders.set(reminderKey, true);
            
            // 1시간 후 키 삭제 (메모리 정리)
            setTimeout(() => {
              sentReminders.delete(reminderKey);
            }, 60 * 60 * 1000);
          } else {
            console.log(`⚠️ 중복 알림 방지: "${todo.task}" ${reminderTime}분 전 알림 이미 전송됨`);
          }
        }
      });
    });
    
  } catch (err) {
    console.error('❌ 시간별 알림 체크 오류:', err);
  }
}

// 시간별 알림 전송
async function sendTimeBasedReminder(todo, minutesBefore) {
  try {
    let message = '';
    let timeText = '';
    
    if (minutesBefore === 0) {
      timeText = '지금';
      message = `⏰ ${todo.time} 할일 알림\n\n📝 ${todo.task}`;
    } else {
      timeText = `${minutesBefore}분 전`;
      message = `⏰ ${todo.time} 할일 ${timeText} 알림\n\n📝 ${todo.task}`;
    }
    
    // 텔레그램으로 알림 전송
    await bot.sendMessage(CHAT_ID, message);
    console.log(`✅ ${timeText} 알림 전송: ${todo.task}`);
    
  } catch (err) {
    console.error('❌ 시간별 알림 전송 오류:', err);
  }
}

// 시간을 분 단위로 변환
function parseTimeToMinutes(timeStr) {
  const match = timeStr.match(/^(\d{1,2}):(\d{1,2})$/);
  if (match) {
    return parseInt(match[1]) * 60 + parseInt(match[2]);
  }
  return 0;
}

// 텔레그램 웹훅 처리
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    if (update.message && update.message.text) {
      const message = update.message.text.trim();
      const chatId = update.message.chat.id;
      
      console.log('📱 텔레그램 메시지:', message);
      
      // 특별 명령어 처리
      if (message === '알림테스트') {
        await testReminders();
        await bot.sendMessage(chatId, '🧪 알림 테스트가 실행되었습니다. 로그를 확인해주세요.');
        res.sendStatus(200);
        return;
      }
      
      if (message === '할일확인') {
        const result = await callGAS('getTodoListForReminders', {});
        if (result && result.success && result.data) {
          const todos = result.data;
          let response = `📋 오늘 할일 ${todos.length}개:\n\n`;
          todos.forEach(todo => {
            response += `⏰ ${todo.time} - ${todo.task}\n`;
          });
          await bot.sendMessage(chatId, response);
        } else {
          await bot.sendMessage(chatId, '📝 오늘 할일이 없습니다.');
        }
        res.sendStatus(200);
        return;
      }
      
      // GAS로 메시지 전달
      const result = await callGAS('processTelegramMessage', {
        message: message,
        chatId: chatId
      });
      
      if (result && result.success && result.response) {
        // 응답을 텔레그램으로 전송
        await bot.sendMessage(chatId, result.response);
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('❌ 웹훅 처리 오류:', error);
    res.sendStatus(500);
  }
});

// 알림 테스트 함수
async function testReminders() {
  console.log('🧪 알림 테스트 시작');
  try {
    await checkTimeBasedReminders();
    console.log('✅ 알림 테스트 완료');
  } catch (err) {
    console.error('❌ 알림 테스트 오류:', err);
  }
}

// 서버 시작
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 할일 관리 봇 서버가 포트 ${PORT}에서 시작되었습니다.`);
  console.log(`⏰ 한국 시간: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
});

// 에러 핸들링
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ 처리되지 않은 Promise 거부:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ 처리되지 않은 예외:', error);
}); 
