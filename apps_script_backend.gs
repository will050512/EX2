/**
 * Google Apps Script Web App 後端 - 調試版本
 * 用於處理英語學習平台的用戶註冊和資料管理
 */

// 設定 Google Sheets ID（請替換為您的試算表 ID）
const SPREADSHEET_ID = '1E8VLVMpBhC_fVW43xr_8r9CDt7cG_7sPpZfk6vZpVXc';
const SHEET_NAME = '用戶註冊資料';

/**
 * Web App 主要入口點 - 處理所有 HTTP 請求
 */
function doPost(e) {
  console.log('=== doPost 開始執行 ===');
  console.log('完整請求物件 (keys):', Object.keys(e || {}));

  try {
    // 設定 CORS headers（createResponse 會加上相同 headers）
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };

    // 嘗試解析請求資料，支援 JSON 與 form-urlencoded（以及 e.parameter）
    let requestData = null;

    if (e.postData && e.postData.contents) {
      console.log('postData.type:', e.postData.type);
      const contentType = (e.postData.type || '').toLowerCase();

      // JSON 請求
      if (contentType.indexOf('application/json') !== -1) {
        try {
          requestData = JSON.parse(e.postData.contents);
          console.log('解析 JSON 成功', requestData);
        } catch (err) {
          console.error('JSON 解析錯誤:', err.message);
          return createResponse({
            success: false,
            error: '無效的 JSON 格式',
            debug: { rawContents: e.postData.contents, parseError: err.message }
          });
        }
      }
      // form-urlencoded 請求（例如: action=addRow&data=%7B...%7D）
      else if (contentType.indexOf('application/x-www-form-urlencoded') !== -1 || typeof e.postData.contents === 'string') {
        // 先嘗試使用 e.parameter（Apps Script 會自動解析 form-urlencoded 到 e.parameter）
        if (e.parameter && Object.keys(e.parameter).length > 0) {
          requestData = {};
          Object.keys(e.parameter).forEach(k => {
            requestData[k] = e.parameter[k];
          });
        } else {
          // 手動解析 raw query string
          const raw = e.postData.contents || '';
          const parts = raw.split('&');
          requestData = {};
          parts.forEach(p => {
            if (!p) return;
            const kv = p.split('=');
            const key = decodeURIComponent(kv[0] || '');
            const val = decodeURIComponent(kv.slice(1).join('=') || '');
            requestData[key] = val;
          });
        }

        // 如果有 data 欄位且是 JSON 字串，嘗試再解析一次
        if (requestData.data && typeof requestData.data === 'string') {
          try {
            requestData.data = JSON.parse(requestData.data);
          } catch (err) {
            // 非致命錯誤：保持原字串並記錄
            console.warn('解析 requestData.data 為 JSON 失敗，保留原字串', err.message);
          }
        }

        console.log('解析 form-urlencoded 結果:', JSON.stringify(requestData));
      }
    }
    // 有時候前端會把參數以 querystring 傳來（或 Apps Script 自動填入 e.parameter）
    if (!requestData && e.parameter && Object.keys(e.parameter).length > 0) {
      requestData = {};
      Object.keys(e.parameter).forEach(k => requestData[k] = e.parameter[k]);
      if (requestData.data && typeof requestData.data === 'string') {
        try { requestData.data = JSON.parse(requestData.data); } catch (err) { /* ignore */ }
      }
      console.log('從 e.parameter 取得 requestData:', JSON.stringify(requestData));
    }

    if (!requestData) {
      console.error('沒有收到 postData 或參數');
      return createResponse({
        success: false,
        error: '沒有收到請求資料',
        debug: { hasPostData: !!e.postData, parameterKeys: Object.keys(e.parameter || {}) }
      });
    }

    const action = requestData.action;
    const email = requestData.email;
    const phone = requestData.phone;
    const data = requestData.data || requestData; // 若整個 payload 就是 data，允許回退
    const origin = requestData.origin || e.parameter && e.parameter.origin;

    console.log('請求 action:', action, 'origin:', origin);

    let response;
    switch (action) {
      case 'checkUser':
        response = checkUserExists(email, phone);
        break;
      case 'addRow':
        response = addUserData(data);
        break;
      default:
        response = { success: false, error: '未知的操作類型: ' + action, debug: { receivedAction: action } };
    }

    console.log('回應結果:', JSON.stringify(response));
    return createResponse(response);

  } catch (error) {
    console.error('doPost 執行錯誤:', error);
    return createResponse({
      success: false,
      error: '伺服器內部錯誤: ' + error.message,
      debug: { stack: error.stack }
    });
  }
}
/**
 * 處理 OPTIONS 請求（CORS 預檢請求）
 */
function doOptions(e) {
  console.log('收到 OPTIONS 請求');
  return createResponse({
    success: true,
    message: 'CORS preflight handled'
  });
}

/**
 * 處理 GET 請求
 */
function doGet(e) {
  console.log('收到 GET 請求:', JSON.stringify(e.parameters, null, 2));
  return createResponse({
    success: true,
    message: 'Google Apps Script Web App 運作正常',
    timestamp: new Date().toISOString(),
    debug: {
      parameters: e.parameters,
      pathInfo: e.pathInfo
    }
  });
}

/**
 * 建立標準化回應
 */
function createResponse(data) {
  const response = ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
    
  // 設定 CORS headers
  response.setHeaders({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  
  return response;
}

/**
 * 檢查用戶是否已存在 - 加強版
 */
function checkUserExists(email, phone) {
  console.log('=== checkUserExists 開始 ===');
  console.log('檢查 Email:', email);
  console.log('檢查 Phone:', phone);
  
  try {
    const sheet = getOrCreateSheet();
    console.log('成功取得工作表');
    
    const dataRange = sheet.getDataRange();
    const data = dataRange.getValues();
    
    console.log('工作表總行數:', data.length);
    console.log('工作表總列數:', data.length > 0 ? data[0].length : 0);
    
    // 如果只有標題列或沒有資料
    if (data.length <= 1) {
      console.log('工作表沒有資料，用戶可以註冊');
      return {
        success: true,
        userExists: false,
        message: '尚無用戶資料',
        debug: {
          totalRows: data.length,
          headers: data.length > 0 ? data[0] : []
        }
      };
    }

    // 假設第一列是標題列
    const headers = data[0];
    console.log('標題列:', headers);
    
    // 找到 Email 和 Phone 的欄位索引
    const emailColIndex = headers.findIndex(h => h.toString().toLowerCase().includes('email'));
    const phoneColIndex = headers.findIndex(h => h.toString().toLowerCase().includes('電話') || h.toString().toLowerCase().includes('phone'));
    
    console.log('Email 欄位索引:', emailColIndex);
    console.log('Phone 欄位索引:', phoneColIndex);

    // 從第二列開始檢查
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const existingEmail = emailColIndex >= 0 ? row[emailColIndex] : '';
      const existingPhone = phoneColIndex >= 0 ? row[phoneColIndex] : '';

      console.log(`第 ${i+1} 列 - Email: "${existingEmail}", Phone: "${existingPhone}"`);

      // 檢查 Email 或電話是否重複
      if ((email && existingEmail && existingEmail.toString() === email.toString()) || 
          (phone && existingPhone && existingPhone.toString() === phone.toString())) {
        console.log('找到重複用戶');
        return {
          success: true,
          userExists: true,
          message: '用戶已存在',
          debug: {
            matchedRow: i + 1,
            matchedEmail: existingEmail,
            matchedPhone: existingPhone
          }
        };
      }
    }

    console.log('用戶不存在，可以註冊');
    return {
      success: true,
      userExists: false,
      message: '用戶不存在，可以註冊',
      debug: {
        totalRowsChecked: data.length - 1,
        emailColIndex: emailColIndex,
        phoneColIndex: phoneColIndex
      }
    };

  } catch (error) {
    console.error('檢查用戶失敗:', error);
    console.error('錯誤堆疊:', error.stack);
    return {
      success: false,
      error: '檢查用戶時發生錯誤: ' + error.message,
      debug: {
        errorStack: error.stack
      }
    };
  }
}

/**
 * 新增用戶資料到 Google Sheets - 加強版
 */
function addUserData(userData) {
  console.log('=== addUserData 開始 ===');
  console.log('收到的用戶資料:', JSON.stringify(userData, null, 2));
  
  try {
    // 驗證必要欄位
    if (!userData) {
      throw new Error('沒有收到用戶資料');
    }

    if (!userData.email || !userData.contactPhone) {
      throw new Error('缺少必要欄位：email 或 contactPhone');
    }

    // 再次檢查重複（雙重保險）
    const duplicateCheck = checkUserExists(userData.email, userData.contactPhone);
    if (duplicateCheck.success && duplicateCheck.userExists) {
      console.log('發現重複用戶，拒絕註冊');
      return {
        success: false,
        error: '此 Email 或電話號碼已經註冊過',
        debug: duplicateCheck.debug
      };
    }

    const sheet = getOrCreateSheet();
    console.log('成功取得工作表，準備新增資料');
    
    // 確保 location 物件存在
    const location = userData.location || {};
    
    // 準備要插入的資料列（按照標題列順序）
    const newRow = [
      userData.parentName || '',
      userData.contactPhone || '',
      userData.email || '',
      userData.childAge || '',
      location.city || '',
      location.region || '',
      location.country || '',
      location.ip || '',
      location.timezone || '',
      userData.registrationTime || new Date().toISOString(),
      userData.trialEndTime || '',
      '啟用'
    ];

    console.log('準備新增的資料列:', newRow);

    // 新增資料到試算表
    sheet.appendRow(newRow);
    
    // 取得新增的列號
    const lastRow = sheet.getLastRow();
    
    console.log('用戶資料已新增到第', lastRow, '列');

    return {
      success: true,
      message: '用戶資料新增成功',
      rowNumber: lastRow,
      timestamp: new Date().toISOString(),
      debug: {
        insertedData: newRow,
        lastRow: lastRow
      }
    };

  } catch (error) {
    console.error('新增用戶資料失敗:', error);
    console.error('錯誤堆疊:', error.stack);
    return {
      success: false,
      error: '新增用戶資料時發生錯誤: ' + error.message,
      debug: {
        errorStack: error.stack,
        receivedData: userData
      }
    };
  }
}

/**
 * 取得或建立工作表 - 加強版
 */
function getOrCreateSheet() {
  console.log('=== getOrCreateSheet 開始 ===');
  console.log('試算表 ID:', SPREADSHEET_ID);
  console.log('工作表名稱:', SHEET_NAME);
  
  try {
    // 檢查 SPREADSHEET_ID 是否有效
    if (!SPREADSHEET_ID || SPREADSHEET_ID.length < 40) {
      throw new Error('無效的 SPREADSHEET_ID，請檢查 ID 是否正確');
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    console.log('成功開啟試算表');
    
    let sheet = spreadsheet.getSheetByName(SHEET_NAME);
    
    // 如果工作表不存在，就建立一個新的
    if (!sheet) {
      console.log('工作表不存在，建立新工作表');
      sheet = spreadsheet.insertSheet(SHEET_NAME);
      
      // 建立標題列
      const headers = [
        '家長姓名',
        '聯絡電話',
        'Email',
        '孩子年齡',
        '城市',
        '地區',
        '國家',
        'IP位址',
        '時區',
        '註冊時間',
        '試用結束時間',
        '狀態'
      ];
      
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      
      // 設定標題列格式
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#4285f4');
      headerRange.setFontColor('white');
      
      // 自動調整欄寬
      sheet.autoResizeColumns(1, headers.length);
      
      console.log('已建立新的工作表:', SHEET_NAME);
    } else {
      console.log('工作表已存在');
    }
    
    return sheet;
    
  } catch (error) {
    console.error('取得工作表失敗:', error);
    console.error('錯誤堆疊:', error.stack);
    
    // 提供更詳細的錯誤訊息
    if (error.message.includes('not found') || error.message.includes('Permission denied')) {
      throw new Error('無法存取 Google Sheets，請檢查：1) SPREADSHEET_ID 是否正確 2) 試算表是否存在 3) Web App 是否有存取權限');
    }
    
    throw new Error('無法存取 Google Sheets: ' + error.message);
  }
}

/**
 * 測試連線功能
 */
function testConnection() {
  console.log('=== 測試連線開始 ===');
  
  try {
    const sheet = getOrCreateSheet();
    console.log('✅ 工作表連線成功');
    
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    console.log('工作表最後一列:', lastRow);
    console.log('工作表最後一欄:', lastCol);
    
    if (lastRow > 0) {
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      console.log('標題列:', headers);
    }
    
    return {
      success: true,
      message: '連線測試成功',
      debug: {
        lastRow: lastRow,
        lastCol: lastCol,
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    console.error('❌ 連線測試失敗:', error);
    return {
      success: false,
      error: error.message,
      debug: {
        errorStack: error.stack,
        timestamp: new Date().toISOString()
      }
    };
  }
}

/**
 * 手動測試函數
 */
function manualTest() {
  console.log('=== 手動測試開始 ===');
  
  // 測試連線
  const connectionResult = testConnection();
  console.log('連線測試結果:', connectionResult);
  
  if (!connectionResult.success) {
    console.log('連線失敗，停止測試');
    return;
  }
  
  // 測試新增用戶
  const testUserData = {
    parentName: '測試家長_' + new Date().getTime(),
    contactPhone: '0912345' + Math.floor(Math.random() * 1000),
    email: 'test_' + new Date().getTime() + '@example.com',
    childAge: '8',
    location: {
      city: '台北市',
      region: '台北市',
      country: '台灣',
      ip: '127.0.0.1',
      timezone: 'Asia/Taipei'
    },
    registrationTime: new Date().toISOString(),
    trialEndTime: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
  };
  
  const addResult = addUserData(testUserData);
  console.log('新增用戶結果:', addResult);
  
  // 測試檢查重複
  const checkResult = checkUserExists(testUserData.email, testUserData.contactPhone);
  console.log('檢查重複結果:', checkResult);
  
  console.log('=== 手動測試完成 ===');
}