import React, { useState, useEffect } from 'react';
import { 
  X, Bot, FolderCheck, Check, Copy, RefreshCw, 
  ExternalLink, CheckCircle2, Database, Play, ArrowRight, Clock, FileCode,
  UploadCloud, DownloadCloud, AlertCircle
} from 'lucide-react';
import { 
  getSavedSupabaseConfig, 
  saveSupabaseConfig, 
  getSupabaseClient, 
  SupabaseConfig 
} from '../lib/supabaseClient';
import { 
  SUPABASE_SQL_SCHEMA, 
  supabaseBulkSyncAll, 
  supabaseFetchProjects, 
  supabaseFetchRecords, 
  supabaseFetchBuffer 
} from '../lib/supabaseCrud';
import { Project, RecordItem, BufferItem } from '../types';

interface AutoBotSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportBotBill: (billData: any) => void;
  onImportBatchBotBills?: (billsData: any[]) => void;
  projects?: Project[];
  records?: RecordItem[];
  buffer?: BufferItem[];
  onDataReloaded?: (projects: Project[], records: RecordItem[], buffer: BufferItem[]) => void;
}

export const AutoBotSyncModal: React.FC<AutoBotSyncModalProps> = ({
  isOpen,
  onClose,
  onImportBotBill,
  onImportBatchBotBills,
  projects = [],
  records = [],
  buffer = [],
  onDataReloaded
}) => {
  const [activeTab, setActiveTab] = useState<'drive_script' | 'supabase'>('drive_script');
  const [copied, setCopied] = useState<string | null>(null);

  // Supabase state
  const [supabaseConfig, setSupabaseConfig] = useState<SupabaseConfig>(getSavedSupabaseConfig());
  const [isSupabaseConnected, setIsSupabaseConnected] = useState(false);
  const [supabaseStatusMsg, setSupabaseStatusMsg] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  // Live Bot Bills state
  const [liveBotBills, setLiveBotBills] = useState<any[]>([]);
  const [isLoadingBotBills, setIsLoadingBotBills] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/bot-import-bill` : '/api/bot-import-bill';
  const webhookBatchUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/bot-import-batch` : '/api/bot-import-batch';
  const folderId = '1Z6-WNDovLWEYQsYllTTPCDLIwQt3ufjx';
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}?usp=sharing`;

  const handleImportAllLiveBills = () => {
    if (liveBotBills.length === 0) return;
    if (onImportBatchBotBills) {
      onImportBatchBotBills(liveBotBills.map(b => b.data));
    } else {
      liveBotBills.forEach(b => onImportBotBill(b.data));
    }
    fetch('/api/bot-bills/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    setLiveBotBills([]);
  };

  // Fetch bot bills
  const fetchBotBills = async () => {
    setIsLoadingBotBills(true);
    try {
      const res = await fetch('/api/bot-bills');
      const data = await res.json();
      if (data.success && data.bills) {
        setLiveBotBills(data.bills);
      }
    } catch (e) {
      console.error('Failed to fetch bot bills:', e);
    } finally {
      setIsLoadingBotBills(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchBotBills();
      const interval = setInterval(fetchBotBills, 4000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  // Test Supabase connection
  const handleTestSupabase = async () => {
    if (!supabaseConfig.url || !supabaseConfig.anonKey) {
      setSupabaseStatusMsg('❌ โปรดกรอก URL และ Anon Key ของ Supabase ให้ครบถ้วน');
      return;
    }
    saveSupabaseConfig(supabaseConfig);
    const client = getSupabaseClient();
    if (!client) {
      setSupabaseStatusMsg('❌ ไม่สามารถสร้าง Supabase Client ได้ โปรดตรวจ URL');
      return;
    }

    try {
      setSupabaseStatusMsg('⏳ กำลังทดสอบเชื่อมต่อ Supabase...');
      const { data, error } = await client.from('reconciliation_records').select('id').limit(1);
      if (error && error.code !== 'PGRST116') {
        if (error.message.includes('relation') || error.message.includes('does not exist')) {
          setIsSupabaseConnected(true);
          setSupabaseStatusMsg('⚠️ เชื่อมต่อ Supabase สำเร็จ! (แต่ยังไม่พบตารางในฐานข้อมูล โปรดคัดลอก SQL ด้านล่างไปรันใน Supabase SQL Editor)');
        } else {
          setIsSupabaseConnected(false);
          setSupabaseStatusMsg(`❌ ผิดพลาด: ${error.message}`);
        }
      } else {
        setIsSupabaseConnected(true);
        setSupabaseStatusMsg('✅ เชื่อมต่อ Supabase สำเร็จ พร้อมใช้งาน CRUD และ Realtime Sync ครบ 3 ตาราง!');
      }
    } catch (err: any) {
      setIsSupabaseConnected(false);
      setSupabaseStatusMsg(`❌ เชื่อมต่อล้มเหลว: ${err.message}`);
    }
  };

  const handleBulkSyncToCloud = async () => {
    if (!isSupabaseConnected) {
      alert('กรุณาทดสอบการเชื่อมต่อ Supabase ให้ผ่านก่อน');
      return;
    }
    if (!confirm(`คุณต้องการอัปโหลดข้อมูลจากเครื่องขึ้น Supabase Cloud หรือไม่?\n\n- โครงการ: ${projects.length} รายการ\n- ตารางบิล 38 คอลัมน์: ${records.length} รายการ\n- กล่องพักรอชนบิล: ${buffer.length} รายการ\n\n(ข้อมูลจะถูกบันทึกลงฐานข้อมูลจริงบน Cloud ทันที)`)) {
      return;
    }
    setIsSyncing(true);
    const result = await supabaseBulkSyncAll(projects, records, buffer);
    setIsSyncing(false);
    alert(result.message);
  };

  const handlePullFromCloud = async () => {
    if (!isSupabaseConnected) {
      alert('กรุณาทดสอบการเชื่อมต่อ Supabase ให้ผ่านก่อน');
      return;
    }
    if (!confirm('ต้องการดึงข้อมูลล่าสุดทั้งหมดจาก Supabase Cloud มาแสดงผลใช่หรือไม่?')) {
      return;
    }
    setIsSyncing(true);
    try {
      const p = await supabaseFetchProjects();
      const r = await supabaseFetchRecords();
      const b = await supabaseFetchBuffer();
      if (onDataReloaded && p && r && b) {
        onDataReloaded(p, r, b);
        alert(`✅ ดึงข้อมูลจาก Cloud สำเร็จ!\n- โครงการ: ${p.length} รายการ\n- ตารางบิล: ${r.length} รายการ\n- กล่องพัก: ${b.length} รายการ`);
      } else {
        alert('ไม่สามารถดึงข้อมูลได้ โปรดตรวจสอบว่ารัน SQL สร้างตารางใน Supabase แล้ว');
      }
    } catch (e: any) {
      alert('เกิดข้อผิดพลาดในการดึงข้อมูล: ' + e.message);
    } finally {
      setIsSyncing(false);
    }
  };

  // Simulate Bot Push
  const handleSimulateBotPush = async () => {
    setIsSimulating(true);
    try {
      const res = await fetch('/api/simulate-bot-push', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchBotBills();
        alert(`🤖 จำลองการดูดบิลจากโฟลเดอร์สำเร็จ! ได้รับบิล ${data.bill.data.docNo}`);
      }
    } catch (e) {
      alert('เกิดข้อผิดพลาดในการจำลองส่งบิล');
    } finally {
      setIsSimulating(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const googleAppsScriptCode = `/**
 * ==============================================================================
 * Google Apps Script: เฝ้าดูดไฟล์บิลจาก Google Drive อัตโนมัติ 24 ชม. (Gmail อื่น)
 * บริษัท บุรีรัมย์ธงชัยก่อสร้าง จำกัด (BTC)
 * โฟลเดอร์เป้าหมาย: ${folderId} (BTC_Purchasing_Receipts)
 * ==============================================================================
 * จุดเด่น: มีฟังก์ชันติดตั้ง Trigger อัตโนมัติในตัว (ไม่ต้องกดเพิ่ม Trigger เองในเมนู!)
 * ==============================================================================
 */

const CONFIG = {
  FOLDER_ID: "${folderId}",
  RECEIVE_URL: "${webhookUrl}",
  RECEIVE_BATCH_URL: "${webhookBatchUrl}",
  LOG_SHEET_NAME: "BTC_Drive_Sync_Log", // ชื่อ Google Sheet บันทึกประวัติไฟล์ที่ดึงแล้ว
  BATCH_SIZE_PER_TRIGGER: 50,           // ส่งเป็นชุดๆ ละ 50 บิล (ประหยัดโควต้า เร็วแรง ไม่ต้องทำทีละใบ)
  MAX_EXECUTION_SECONDS: 280            // ป้องกันติดขีดจำกัดเวลา 6 นาทีของ Google
};

/**
 * 🌟🌟🌟 ฟังก์ชันที่ 1 (แนะนำที่สุด): ติดตั้ง Trigger + ส่งบิลทั้งหมดเป็นชุด (Batch) ตรงเข้าระบบ 🌟🌟🌟
 * แนะนำให้เลือกฟังก์ชันนี้แล้วกด "เรียกใช้ (Run)":
 * 1. ติดตั้ง Trigger อัตโนมัติให้ทันที (เฝ้าดูดไฟล์ใหม่ต่อเนื่องทุก 1 นาที 24 ชม.)
 * 2. กวาดบิลทั้ง 576 ไฟล์ ส่งตรงเข้าระบบเป็นชุดๆ ละ 50 บิลทันที (เพียง 12 ครั้งเสร็จสิ้นครบหมด!)
 */
function setupAllInOneAndStartAutoTrigger() {
  Logger.log("==================================================");
  Logger.log("🚀 เริ่มต้นการติดตั้งระบบ BTC Drive Auto-Sync แบบ All-in-One");
  Logger.log("==================================================");
  installAutoTrigger();
  Logger.log("📦 เริ่มต้นส่งบิลทั้งหมดเป็นชุด (Batch) ตรงเข้าระบบทันที...");
  syncAllInBatchesDirectly();
  Logger.log("==================================================");
  Logger.log("🎉 การติดตั้งเสร็จสมบูรณ์ 100%!");
  Logger.log("ระบบจะเฝ้าดูดไฟล์ใหม่จาก Drive ให้ต่อเนื่องทุก 1 นาทีอัตโนมัติ 24 ชม.");
  Logger.log("==================================================");
}

/**
 * 🚀 ฟังก์ชันที่ 2: ส่งบิลทั้งหมดที่มีในโฟลเดอร์เป็นชุดๆ ละ 50 บิล ตรงเข้าระบบทันที (ไม่ต้องผ่าน Sheet)
 * - 576 บิล จะถูกรวบส่งแค่ ~12 ครั้งเท่านั้น ประหยัดโควต้าอินเทอร์เน็ตของ Gmail 98%
 */
function syncAllInBatchesDirectly() {
  syncInBatchesToSystem(50);
}

/**
 * แกนหลักการส่งไฟล์เป็นชุด (Batch Ingestion Engine)
 */
function syncInBatchesToSystem(batchSize) {
  const size = batchSize || 50;
  Logger.log("==================================================");
  Logger.log("🚀 เริ่มต้นรวบรวมไฟล์เพื่อส่งเป็นชุด (Batch) เข้าระบบ...");
  Logger.log("📦 กำหนดขนาดชุดละ: " + size + " บิลต่อรอบ");
  Logger.log("==================================================");

  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  Logger.log("📁 ตรวจโฟลเดอร์: " + folder.getName());
  
  const allItems = getFilesRecursive(folder);
  const historySet = getProcessedFileIds();
  const logSheet = getOrCreateLogSheet();

  // กรองเฉพาะไฟล์บิลที่ยังไม่เคยส่ง
  const pendingItems = [];
  let alreadySynced = 0;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    if (!isBillFile(item.file)) continue;
    const fileId = item.file.getId();
    if (historySet.has(fileId)) {
      alreadySynced++;
    } else {
      pendingItems.push(item);
    }
  }

  Logger.log("🔎 พบไฟล์ทั้งหมดจากทุกชั้น: " + allItems.length + " ไฟล์");
  Logger.log("⏩ ข้ามไฟล์เดิมที่เคยส่งแล้ว: " + alreadySynced + " ไฟล์");
  Logger.log("📤 ไฟล์บิลรอส่งเข้าระบบ: " + pendingItems.length + " ไฟล์");

  if (pendingItems.length === 0) {
    Logger.log("🎉 ทุกไฟล์ในโฟลเดอร์ถูกส่งเข้าระบบเรียบร้อยแล้ว ไม่มีไฟล์ค้างส่ง!");
    return;
  }

  const totalBatches = Math.ceil(pendingItems.length / size);
  Logger.log("📊 จะแบ่งส่งทั้งหมด " + totalBatches + " ชุด (ชุดละไม่เกิน " + size + " บิล)");

  let totalSentSuccess = 0;
  let totalFailed = 0;

  for (let b = 0; b < totalBatches; b++) {
    const chunk = pendingItems.slice(b * size, (b + 1) * size);
    const billsPayload = [];

    for (let j = 0; j < chunk.length; j++) {
      const item = chunk[j];
      const file = item.file;
      const parsed = parseFileNameInfo(file.getName());
      billsPayload.push({
        fileId: file.getId(),
        fileName: file.getName(),
        driveFileUrl: file.getUrl(),
        folderPath: item.folderPath,
        docNo: parsed.docNo,
        billType: parsed.billType.indexOf("SUPPLIER") !== -1 ? "SUPPLIER" : "DEST_WEIGHT",
        date: parsed.date,
        refNo: parsed.refNo,
        source: "GOOGLE_DRIVE_BATCH_SYNC"
      });
    }

    Logger.log("📦 กำลังส่งชุดที่ " + (b + 1) + "/" + totalBatches + " (" + chunk.length + " บิล)...");

    try {
      const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ bills: billsPayload }),
        muteHttpExceptions: true
      };

      const res = UrlFetchApp.fetch(CONFIG.RECEIVE_BATCH_URL, options);
      const code = res.getResponseCode();

      if (code >= 200 && code < 300) {
        totalSentSuccess += chunk.length;

        // บันทึกประวัติลงทั้ง Sheet Log และ Cache
        for (let k = 0; k < chunk.length; k++) {
          const item = chunk[k];
          const fid = item.file.getId();
          historySet.add(fid);

          try {
            PropertiesService.getUserProperties().setProperty("SYNCED_" + fid, "1");
          } catch (e) {}

          try {
            const parsed = parseFileNameInfo(item.file.getName());
            logSheet.appendRow([
              fid,
              item.file.getName(),
              new Date(),
              "SUCCESS_BATCH",
              parsed.docNo,
              item.file.getUrl(),
              item.folderPath,
              parsed.billType,
              parsed.date,
              parsed.refNo
            ]);
          } catch (e) {}
        }

        Logger.log("✅ ส่งชุดที่ " + (b + 1) + "/" + totalBatches + " สำเร็จ! (รวมส่งแล้ว: " + totalSentSuccess + "/" + pendingItems.length + " บิล)");
      } else {
        totalFailed += chunk.length;
        Logger.log("⚠️ ชุดที่ " + (b + 1) + " ตอบกลับสถานะ " + code + ": " + res.getContentText());
      }
    } catch (err) {
      totalFailed += chunk.length;
      Logger.log("❌ เกิดข้อผิดพลาดขณะส่งชุดที่ " + (b + 1) + ": " + err.toString());
      if (err.toString().includes("urlfetch")) {
        Logger.log("⚠️ บัญชี Gmail นี้ติดขีดจำกัดโควต้าการเชื่อมต่อ UrlFetch ของ Google ชั่วคราวประจำวัน");
        Logger.log("💡 หากต้องการดึง 576 บิลทันทีในตอนนี้ สามารถรันฟังก์ชัน exportAllDriveBillsToSheet แทนได้ 100%");
        break;
      }
    }

    Utilities.sleep(500); // พัก 0.5 วินาทีระหว่างชุด
  }

  Logger.log("-------------------------------------------------");
  Logger.log("🏁 สรุปผลการส่งข้อมูลเป็นชุด:");
  Logger.log("✅ ส่งสำเร็จ: " + totalSentSuccess + " บิล");
  Logger.log("❌ ส่งไม่สำเร็จ: " + totalFailed + " บิล");
  Logger.log("-------------------------------------------------");
}

/**
 * ⚡ ฟังก์ชันที่ 3: ติดตั้ง Trigger อัตโนมัติ (เฝ้าดูดไฟล์ใหม่ 24 ชม.)
 * จะตั้งเวลาให้ฟังก์ชัน autoSyncNewBills ทำงานทุก 1 นาทีอัตโนมัติ
 */
function installAutoTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "autoSyncNewBills") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger("autoSyncNewBills")
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log("✅ ติดตั้ง Trigger อัตโนมัติสำเร็จ! (ทำงานทุก 1 นาที ต่อเนื่อง 24 ชม.)");
}

/**
 * 🛑 ฟังก์ชันที่ 4: ยกเลิก / หยุด Trigger อัตโนมัติ
 */
function stopAutoTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let count = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "autoSyncNewBills") {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  Logger.log("🛑 หยุดการทำงาน Trigger อัตโนมัติเรียบร้อยแล้ว (" + count + " ทริกเกอร์)");
}

/**
 * 🔄 ฟังก์ชันที่ 5: ฟังก์ชันที่ Trigger เรียกทำงานทุก 1 นาที (ส่งไฟล์ใหม่เป็นชุด)
 */
function autoSyncNewBills() {
  syncInBatchesToSystem(CONFIG.BATCH_SIZE_PER_TRIGGER || 50);
}

/**
 * 📋 ฟังก์ชันที่ 6 (ทางเลือกสำรอง): รวบรวมบิลลง Google Sheet ทันที (ไม่ใช้ UrlFetch)
 * ใช้เมื่อโควต้าอินเทอร์เน็ตของ Gmail หมดในวันนี้
 */
function exportAllDriveBillsToSheet() {
  Logger.log("==================================================");
  Logger.log("🚀 เริ่มต้นรวบรวมบิลทั้งหมดลง Google Sheet...");
  Logger.log("==================================================");

  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const allItems = getFilesRecursive(folder);
  const sheet = getOrCreateLogSheet();
  const historySet = getProcessedFileIds();
  
  let addedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    const file = item.file;
    const fileId = file.getId();
    const fileName = file.getName();

    if (!isBillFile(file)) continue;

    if (historySet.has(fileId)) {
      skippedCount++;
      continue;
    }

    const parsed = parseFileNameInfo(fileName);

    sheet.appendRow([
      fileId,
      fileName,
      new Date(),
      "READY_FOR_IMPORT",
      parsed.docNo,
      file.getUrl(),
      item.folderPath,
      parsed.billType,
      parsed.date,
      parsed.refNo
    ]);

    historySet.add(fileId);
    addedCount++;

    if (addedCount % 50 === 0) {
      Logger.log("📝 บันทึกลง Sheet แล้ว " + addedCount + " บิล...");
    }
  }

  Logger.log("==================================================");
  Logger.log("🎉 บันทึกลง Google Sheet สำเร็จเรียบร้อย!");
  Logger.log("✅ เพิ่มข้อมูลบิลใหม่: " + addedCount + " บิล");
  Logger.log("⏩ มีอยู่แล้วเดิม: " + skippedCount + " บิล");
  Logger.log("📄 เปิดดูได้ที่ Google Sheet: " + CONFIG.LOG_SHEET_NAME);
  Logger.log("==================================================");
}

/**
 * 🚀 ฟังก์ชันที่ 5: ไล่ดึงไฟล์เก่า "ทั้งหมด" ที่มีอยู่ในโฟลเดอร์ให้หมดเกลี้ยง
 */
function syncAllExistingFiles() {
  processBills({ processAll: true, maxFiles: 99999 });
}

/**
 * 📊 ฟังก์ชันที่ 6: ตรวจสอบสถานะประวัติการดึงไฟล์ (ทะลุทุกโฟลเดอร์ย่อย)
 */
function viewSyncSummary() {
  const historySet = getProcessedFileIds();
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const allItems = getFilesRecursive(folder);
  let totalFiles = 0;
  let syncedFiles = 0;
  let pendingFiles = 0;

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    if (!isBillFile(item.file)) continue;
    totalFiles++;
    if (historySet.has(item.file.getId())) {
      syncedFiles++;
    } else {
      pendingFiles++;
    }
  }

  Logger.log("=================================================");
  Logger.log("📊 รายงานสรุปสถานะการซิงค์ไฟล์ Google Drive (ค้นหาทุกโฟลเดอร์ย่อย):");
  Logger.log("📁 โฟลเดอร์หลัก: " + folder.getName());
  Logger.log("📄 ไฟล์บิลทั้งหมดที่พบในทุกชั้น: " + totalFiles + " ไฟล์");
  Logger.log("✅ ดึงสำเร็จแล้ว (มีประวัติ): " + syncedFiles + " ไฟล์");
  Logger.log("⏳ ไฟล์ที่รอส่งเข้าระบบ: " + pendingFiles + " ไฟล์");
  Logger.log("📄 Google Sheet ประวัติ: " + CONFIG.LOG_SHEET_NAME);
  Logger.log("=================================================");
}

/**
 * 🧹 ฟังก์ชันที่ 7: ล้างประวัติการซิงค์ (ใช้เฉพาะเมื่อต้องการให้ระบบดึงใหม่ทั้งหมดอีกครั้ง)
 */
function resetSyncHistory() {
  const files = DriveApp.getFilesByName(CONFIG.LOG_SHEET_NAME);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
  PropertiesService.getUserProperties().deleteAllProperties();
  Logger.log("🧹 ล้างประวัติใน Google Sheet และ Cache เรียบร้อยแล้ว ครั้งต่อไปจะเริ่มดึงใหม่ทั้งหมด");
}

// ------------------------------------------------------------------------------
// Core Engine: ประมวลผลและส่งไฟล์ไปยังระบบ (ค้นหาทะลุโฟลเดอร์ย่อยทุกชั้น ไม่จำกัดความลึก)
// ------------------------------------------------------------------------------
function processBills(options) {
  const startTime = new Date().getTime();
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  
  Logger.log("📁 เริ่มตรวจโฟลเดอร์หลัก: " + folder.getName());
  Logger.log("🔗 ลิงก์โฟลเดอร์: " + folder.getUrl());

  // 1. สำรวจทะลุโฟลเดอร์ย่อยทุกชั้น (Multi-layer Sub-folders)
  const allItems = getFilesRecursive(folder);
  Logger.log("🔎 พบไฟล์ทั้งหมดจากทุกโฟลเดอร์ย่อย: " + allItems.length + " ไฟล์");
  
  if (allItems.length === 0) {
    Logger.log("ℹ️ ในโฟลเดอร์นี้และโฟลเดอร์ย่อยข้างในยังไม่มีไฟล์เลยครับ");
    Logger.log("💡 คำแนะนำ: เมื่อมีการอัปโหลดรูปภาพบิลหรือ PDF เข้าโฟลเดอร์ย่อยใดๆ ก็ตาม ทริกเกอร์ที่ติดตั้งไว้จะตรวจพบและดูดเข้าระบบอัตโนมัติภายใน 1 นาทีครับ!");
    return;
  }

  // 2. โหลดประวัติไฟล์ที่เคยดึงแล้วทั้งหมด
  const historySet = getProcessedFileIds();
  const logSheet = getOrCreateLogSheet();
  
  let processedCount = 0;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < allItems.length; i++) {
    const elapsedSeconds = (new Date().getTime() - startTime) / 1000;
    if (elapsedSeconds > CONFIG.MAX_EXECUTION_SECONDS) {
      Logger.log("⏱️ ใช้เวลาใกล้ถึงขีดจำกัดแล้ว ขอตัดจบรอบนี้เพื่อความปลอดภัย (รอบถัดไปจะดึงต่ออัตโนมัติ)");
      break;
    }

    if (!options.processAll && processedCount >= options.maxFiles) {
      break;
    }

    const item = allItems[i];
    const file = item.file;
    const fileId = file.getId();
    const fileName = file.getName();

    // ข้ามไฟล์ที่ไม่ใช่รูปหรือ PDF
    if (!isBillFile(file)) {
      continue;
    }

    // ข้ามไฟล์ที่เคยดึงสำเร็จแล้ว (ตามประวัติ)
    if (historySet.has(fileId)) {
      skippedCount++;
      continue;
    }

    Logger.log("📦 กำลังส่งไฟล์ (" + (processedCount + 1) + "): " + fileName + " (จาก: " + item.folderPath + ")");

    const success = sendFileToWebhook(file, logSheet, item.folderPath);
    processedCount++;

    if (success) {
      successCount++;
      historySet.add(fileId);
    } else {
      failCount++;
    }

    Utilities.sleep(300); // เว้นระยะเล็กน้อยเพื่อเสถียรภาพ
  }

  Logger.log("-------------------------------------------------");
  Logger.log("🏁 รายงานผลการทำงานรอบนี้:");
  Logger.log("✅ ส่งสำเร็จ: " + successCount + " ไฟล์");
  Logger.log("❌ ส่งไม่สำเร็จ: " + failCount + " ไฟล์ (จะลองใหม่รอบหน้า)");
  Logger.log("⏩ ข้ามไฟล์เดิมที่เคยส่งแล้ว: " + skippedCount + " ไฟล์");
  Logger.log("-------------------------------------------------");
}

/**
 * ฟังก์ชันสำรวจทะลุโฟลเดอร์ย่อยทุกชั้น (Breadth-First Search: BFS Queue)
 * รองรับโครงสร้างซ้อนกันหลายชั้น ไม่ว่าจะลึก 2 ชั้น 5 ชั้น หรือ 10 ชั้น
 */
function getFilesRecursive(rootFolder) {
  let fileList = [];
  let folderQueue = [{ folder: rootFolder, path: rootFolder.getName() }];
  let totalFoldersChecked = 0;

  while (folderQueue.length > 0) {
    const current = folderQueue.shift();
    totalFoldersChecked++;

    // 1. อ่านไฟล์ในโฟลเดอร์นี้
    try {
      const files = current.folder.getFiles();
      let filesInThisFolder = 0;
      while (files.hasNext()) {
        const file = files.next();
        fileList.push({ file: file, folderPath: current.path });
        filesInThisFolder++;
      }
      if (filesInThisFolder > 0) {
        Logger.log("📂 เจอ " + filesInThisFolder + " ไฟล์ใน: [" + current.path + "]");
      }
    } catch (e) {
      Logger.log("⚠️ อ่านไฟล์ใน [" + current.path + "] ไม่สำเร็จ: " + e.toString());
    }

    // 2. ดึงโฟลเดอร์ย่อยชั้นถัดไปเข้าคิวสำรวจ
    try {
      const subfolders = current.folder.getFolders();
      while (subfolders.hasNext()) {
        const sub = subfolders.next();
        folderQueue.push({
          folder: sub,
          path: current.path + " > " + sub.getName()
        });
      }
    } catch (e) {
      Logger.log("⚠️ อ่านโฟลเดอร์ย่อยใน [" + current.path + "] ไม่สำเร็จ: " + e.toString());
    }
  }

  Logger.log("📊 ตรวจสอบรวมทั้งหมด " + totalFoldersChecked + " โฟลเดอร์ (รวมชั้นย่อยทั้งหมด)");
  return fileList;
}

/**
 * ตรวจสอบว่าเป็นไฟล์บิลหรือไม่ (รูปภาพ JPG, PNG, WEBP, HEIC หรือ PDF)
 */
function isBillFile(file) {
  try {
    const mime = (file.getMimeType() || "").toLowerCase();
    const name = (file.getName() || "").toLowerCase();
    if (mime.indexOf("image/") === 0 || mime === "application/pdf") return true;
    if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png") ||
        name.endsWith(".pdf") || name.endsWith(".webp") || name.endsWith(".heic")) {
      return true;
    }
  } catch (e) {}
  return false;
}

function sendFileToWebhook(file, logSheet, folderPath) {
  try {
    const fileName = file.getName();
    const parsed = parseFileNameInfo(fileName);

    const payload = {
      driveFileName: fileName,
      driveFileId: file.getId(),
      driveFileUrl: file.getUrl(),
      driveFolderPath: folderPath || "",
      docNo: parsed.docNo,
      billType: parsed.billType.indexOf("SUPPLIER") !== -1 ? "SUPPLIER" : "DEST_WEIGHT",
      date: parsed.date,
      source: "GOOGLE_DRIVE_BOT_AUTO"
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(CONFIG.RECEIVE_URL, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      let docNo = parsed.docNo;
      try {
        const json = JSON.parse(responseText);
        if (json.bill && json.bill.data && json.bill.data.docNo) {
          docNo = json.bill.data.docNo;
        }
      } catch (e) {}

      // 1. บันทึกลง Google Sheet ประวัติ
      logSheet.appendRow([
        file.getId(),
        file.getName(),
        new Date(),
        "SUCCESS",
        docNo,
        file.getUrl(),
        folderPath || "",
        parsed.billType,
        parsed.date,
        parsed.refNo
      ]);

      // 2. บันทึกลง UserProperties เพื่อเป็น Cache สำรองความเร็วสูง
      try {
        PropertiesService.getUserProperties().setProperty("SYNCED_" + file.getId(), "1");
      } catch (e) {}

      // 3. แปะป้ายที่ Description ของไฟล์ (ถ้ามีสิทธิ์เขียน)
      try {
        const desc = file.getDescription() || "";
        if (!desc.includes("[SYNCED_TO_BTC]")) {
          file.setDescription((desc + " [SYNCED_TO_BTC]").trim());
        }
      } catch (e) {}

      Logger.log("✅ ส่งสำเร็จ: " + file.getName() + " (DocNo: " + docNo + ")");
      return true;
    } else {
      Logger.log("⚠️ ปลายทางตอบกลับด้วยสถานะ " + statusCode + ": " + responseText);
      return false;
    }
  } catch (err) {
    if (err.toString().includes("urlfetch")) {
      Logger.log("⚠️ ติดโควต้าจำกัดข้อมูลของ Gmail ประจำวัน (สามารถใช้ฟังก์ชัน exportAllDriveBillsToSheet แทนได้ 100%)");
    } else {
      Logger.log("❌ เกิดข้อผิดพลาดขณะส่งไฟล์ " + file.getName() + ": " + err.toString());
    }
    return false;
  }
}

/**
 * ถอดรหัสข้อมูลสำคัญจากชื่อไฟล์อัตโนมัติ (เช่น เลขที่ใบส่งของ วันที่ และ Ref No)
 */
function parseFileNameInfo(name) {
  let docNo = "-";
  let billType = "ใบส่งของ / ตั๋วชั่ง";
  let date = "";
  let refNo = "";

  try {
    const docNoMatch = name.match(/เลขที่\s*([A-Za-z0-9\-\/]+)/i) || name.match(/No\.?\s*([A-Za-z0-9\-\/]+)/i);
    if (docNoMatch) {
      docNo = docNoMatch[1];
    }

    const refMatch = name.match(/(TR-[\w\-]+)/i);
    if (refMatch) {
      refNo = refMatch[1];
    }

    const dateMatch = name.match(/(20\d{2})(\d{2})(\d{2})/);
    if (dateMatch) {
      date = dateMatch[1] + "-" + dateMatch[2] + "-" + dateMatch[3];
    }

    if (name.includes("ใบส่งของ")) billType = "ใบส่งของ (SUPPLIER)";
    else if (name.includes("ตั๋วชั่ง") || name.includes("ชั่ง")) billType = "ตั๋วชั่ง (WEIGHT)";
  } catch (e) {}

  return { docNo: docNo !== "-" ? docNo : (refNo || name), billType, date, refNo };
}

// ------------------------------------------------------------------------------
// Helpers: จัดการ Google Sheet บันทึกประวัติ
// ------------------------------------------------------------------------------
function getOrCreateLogSheet() {
  const files = DriveApp.getFilesByName(CONFIG.LOG_SHEET_NAME);
  let spreadsheet;

  if (files.hasNext()) {
    const file = files.next();
    spreadsheet = SpreadsheetApp.openById(file.getId());
  } else {
    spreadsheet = SpreadsheetApp.create(CONFIG.LOG_SHEET_NAME);
    const sheet = spreadsheet.getActiveSheet();
    sheet.setName("History_Log");
    sheet.appendRow([
      "File_ID",
      "File_Name",
      "Sync_Timestamp",
      "Status",
      "Detected_Doc_No",
      "Drive_URL",
      "Folder_Path",
      "Bill_Type",
      "Document_Date",
      "Ref_No"
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange("A1:J1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
    Logger.log("📄 สร้าง Google Sheet ประวัติสำเร็จ: " + spreadsheet.getUrl());
  }

  return spreadsheet.getActiveSheet();
}

function getProcessedFileIds() {
  const set = new Set();
  
  // 1. อ่านจาก Google Sheet Log
  try {
    const sheet = getOrCreateLogSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        const id = String(ids[i][0]).trim();
        if (id) set.add(id);
      }
    }
  } catch (err) {
    Logger.log("⚠️ อ่านประวัติจาก Sheet Log: " + err.toString());
  }

  // 2. อ่านจาก Cache สำรอง
  try {
    const props = PropertiesService.getUserProperties().getProperties();
    for (const key in props) {
      if (key.startsWith("SYNCED_")) {
        set.add(key.replace("SYNCED_", ""));
      }
    }
  } catch (e) {}

  return set;
}
`;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-5 font-sans">
      <div className="bg-white rounded-2xl max-w-4xl w-full flex flex-col shadow-2xl overflow-hidden border border-slate-300 max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex justify-between items-center shrink-0 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-md">
              <FolderCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base tracking-wide">ระบบดึงบิลอัตโนมัติจาก Google Drive (Gmail อื่น)</h3>
                <span className="px-2 py-0.5 text-[10px] rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/40">
                  Auto-Sync Active
                </span>
              </div>
              <p className="text-xs text-slate-400">
                ตั้งให้ Google Drive ดูดไฟล์ส่งเข้าสู่ระบบกระทบยอดให้อัตโนมัติ โดยไม่ต้องขอ OAuth
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live Bot Inflow Banner */}
        <div className="bg-blue-950 px-6 py-2.5 border-b border-blue-900/80 flex flex-wrap items-center justify-between gap-2 text-xs text-blue-200 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span>บิลที่ระบบดูดเข้ามาจาก Google Drive:</span>
            <strong className="text-amber-300 font-mono">{liveBotBills.length} รายการ</strong>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSimulateBotPush}
              disabled={isSimulating}
              className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold flex items-center space-x-1.5 transition shadow-xs cursor-pointer"
              title="ทดสอบเสมือนว่าสคริปต์ใน Google Drive ตรวจพบรูปใหม่แล้วดูดส่งเข้ามา"
            >
              <Play className="w-3.5 h-3.5 text-amber-300" />
              <span>{isSimulating ? 'กำลังทดสอบ...' : '⚡ ทดสอบดึงบิลจาก Drive เข้ามา'}</span>
            </button>
            <button
              onClick={fetchBotBills}
              disabled={isLoadingBotBills}
              className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-xs cursor-pointer"
              title="รีเฟรชรายการบิลล่าสุด"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBotBills ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs (2 clean tabs) */}
        <div className="flex border-b border-slate-200 bg-slate-100 text-xs font-bold text-slate-600 px-6 shrink-0">
          <button
            onClick={() => setActiveTab('drive_script')}
            className={`py-3 px-4 border-b-2 transition flex items-center space-x-2 cursor-pointer ${
              activeTab === 'drive_script'
                ? 'border-blue-600 text-blue-900 bg-white shadow-2xs font-extrabold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <FolderCheck className="w-4 h-4 text-emerald-600" />
            <span>1. สคริปต์เฝ้าดูดบิล Google Drive (ระบบส่งเป็นชุด Batch อัตโนมัติ)</span>
          </button>
          <button
            onClick={() => setActiveTab('supabase')}
            className={`py-3 px-4 border-b-2 transition flex items-center space-x-2 cursor-pointer ${
              activeTab === 'supabase'
                ? 'border-blue-600 text-blue-900 bg-white shadow-2xs font-extrabold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <Database className="w-4 h-4 text-teal-600" />
            <span>2. Supabase Cloud (Realtime Database)</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-5 text-slate-800 text-xs flex-1">
          {/* TAB 1: GOOGLE APPS SCRIPT FOR OTHER GMAIL */}
          {activeTab === 'drive_script' && (
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
                <h4 className="font-bold text-emerald-950 text-sm flex items-center gap-1.5 mb-1">
                  <FolderCheck className="w-4 h-4 text-emerald-700" />
                  วิธีติดตั้งสคริปต์เฝ้าดูดไฟล์จากโฟลเดอร์ Google Drive (ทำเพียงครั้งเดียว):
                </h4>
                <p className="text-emerald-900 text-xs leading-relaxed">
                  เนื่องจากโฟลเดอร์ <strong className="font-mono bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-950 border border-emerald-300">{folderId}</strong> อยู่ใน Gmail บัญชีอื่น เพียงนำสคริปต์ด้านล่างนี้ไปแปะในบัญชี Gmail นั้น สคริปต์จะคอยตรวจดูดไฟล์ภาพบิลใหม่และส่งมาให้ระบบเราอัตโนมัติ <strong>โดยที่คุณไม่ต้องเปิดหน้าเว็บทิ้งไว้เลย</strong>
                </p>
              </div>

              {/* 3 Step Visual Guide */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                  <div className="flex items-center space-x-1.5 text-blue-800 font-bold">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px]">1</span>
                    <span>เปิด Apps Script ใน Gmail</span>
                  </div>
                  <p className="text-slate-600 text-[11px]">
                    เปิด <a href="https://script.google.com" target="_blank" rel="noreferrer" className="text-blue-600 underline font-bold">script.google.com</a> ด้วยบัญชีที่มีโฟลเดอร์ &gt; กด "โครงการใหม่"
                  </p>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                  <div className="flex items-center space-x-1.5 text-blue-800 font-bold">
                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px]">2</span>
                    <span>วางโค้ดสคริปต์</span>
                  </div>
                  <p className="text-slate-600 text-[11px]">
                    กดปุ่ม <strong className="text-blue-900">"คัดลอกโค้ดทั้งหมด"</strong> ด้านล่าง วางแทนโค้ดเดิมในหน้าต่างแล้วกดบันทึก (Ctrl+S)
                  </p>
                </div>

                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl space-y-1 shadow-xs">
                  <div className="flex items-center space-x-1.5 text-emerald-900 font-bold">
                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">3</span>
                    <span>กดเรียกใช้ "ส่งเป็นชุดตรงเข้าระบบ"</span>
                  </div>
                  <p className="text-emerald-800 text-[11px]">
                    เลือกฟังก์ชัน <strong className="font-mono bg-emerald-200/90 px-1.5 py-0.5 rounded text-emerald-950 font-bold">setupAllInOneAndStartAutoTrigger</strong> หรือ <strong className="font-mono bg-emerald-200/90 px-1.5 py-0.5 rounded text-emerald-950 font-bold">syncAllInBatchesDirectly</strong> แล้วกด <strong>"เรียกใช้ (Run)"</strong> บิล 576 ใบจะส่งเป็นชุดๆ ละ 50 บิล ตรงเข้าระบบทันที ไม่ต้องเข้า Sheet เลย!
                  </p>
                </div>
              </div>

              {/* History Tracking Sheet Callout */}
              <div className="bg-blue-50/70 border border-blue-200 p-3 rounded-xl flex items-start space-x-2 text-[11px] text-blue-900">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong>ระบบบันทึกประวัติอัตโนมัติ (Zero Duplicate & No Data Loss):</strong> สคริปต์จะสร้าง Google Sheet ประวัติชื่อ <code className="bg-blue-100 px-1.5 py-0.5 rounded text-blue-950 font-bold">BTC_Drive_Sync_Log</code> ให้ใน Drive ของคุณอัตโนมัติ เพื่อจดจำ ID ไฟล์ที่เคยส่งแล้ว 100% จึงไม่มีการส่งซ้ำเด็ดขาด และหากเน็ตหลุดหรือมีไฟล์ส่งไม่สำเร็จ ระบบจะไม่บันทึกประวัติและจะลองส่งใหม่ในรอบถัดไปแบบอัตโนมัติ
                </div>
              </div>

              {/* Script Box */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-bold text-slate-800 flex items-center gap-1.5">
                    <FileCode className="w-4 h-4 text-blue-700" />
                    <span>โค้ด Google Apps Script สำเร็จรูป (ผูกโฟลเดอร์ {folderId} เรียบร้อยแล้ว):</span>
                  </label>
                  <button
                    onClick={() => copyToClipboard(googleAppsScriptCode, 'apps_script')}
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 cursor-pointer shadow-xs transition"
                  >
                    {copied === 'apps_script' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copied === 'apps_script' ? 'คัดลอกแล้ว!' : 'คัดลอกโค้ดทั้งหมด'}</span>
                  </button>
                </div>
                <pre className="bg-slate-900 text-slate-200 p-4 rounded-xl font-mono text-[11px] overflow-x-auto max-h-56 leading-relaxed border border-slate-700">
{googleAppsScriptCode}
                </pre>
              </div>

              {/* Live Incoming Bills List */}
              <div className="pt-2">
                <div className="flex justify-between items-center mb-2">
                  <h5 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>รายการบิลที่ระบบดูดเข้ามาล่าสุด ({liveBotBills.length} รายการ):</span>
                  </h5>
                  {liveBotBills.length > 0 && (
                    <span className="text-[11px] text-slate-500">คลิก "+ นำเข้าตาราง" เพื่อชนบิล</span>
                  )}
                </div>

                {liveBotBills.length === 0 ? (
                  <div className="text-center py-6 border border-dashed border-slate-300 rounded-xl bg-slate-50 text-slate-500">
                    <p className="font-semibold">ยังไม่มีบิลส่งเข้ามาในขณะนี้</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      สามารถกดปุ่ม <strong className="text-blue-700">"⚡ ทดสอบดึงบิลจาก Drive เข้ามา"</strong> ด้านบน เพื่อดูตัวอย่างการทำงานได้ทันที
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {liveBotBills.map(b => (
                      <div key={b.id} className="p-3 border border-slate-200 rounded-xl bg-white shadow-2xs flex items-center justify-between gap-3 hover:border-blue-400 transition">
                        <div className="flex items-center space-x-3 truncate">
                          <span className="px-2 py-1 rounded bg-blue-100 text-blue-900 font-mono font-bold text-xs shrink-0">
                            {b.data?.docNo || b.id}
                          </span>
                          <div className="truncate">
                            <div className="font-bold text-slate-900 flex items-center gap-2">
                              <span>{b.data?.supplier || 'โรงโม่ / ตั๋วชั่ง'}</span>
                              <span className="text-[10px] font-normal text-slate-500">({b.driveFileName || 'ไฟล์จาก Drive'})</span>
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              สินค้า: {b.data?.itemDesc} | นน.สุทธิ: {b.data?.netWeight} ตัน | ทะเบียน: {b.data?.vehicleReg}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0">
                          {b.driveFileUrl && (
                            <a
                              href={b.driveFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 text-slate-600 hover:text-blue-700 bg-slate-100 hover:bg-blue-50 rounded text-xs flex items-center space-x-1"
                              title="เปิดดูไฟล์ใน Google Drive"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>ดูไฟล์ใน Drive</span>
                            </a>
                          )}
                          <button
                            onClick={() => {
                              onImportBotBill(b.data);
                              alert(`✅ นำบิล ${b.data?.docNo} เข้ากล่องพักรอชนบิลเรียบร้อยแล้ว!`);
                            }}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold shadow-xs cursor-pointer"
                          >
                            + นำเข้าตาราง
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SUPABASE CLOUD REALTIME */}
          {activeTab === 'supabase' && (
            <div className="space-y-4">
              <div className="bg-teal-50 border border-teal-200 p-4 rounded-xl">
                <h4 className="font-bold text-teal-950 text-sm flex items-center gap-1.5 mb-1">
                  <Database className="w-4 h-4 text-teal-700" />
                  เชื่อมต่อ Supabase Cloud (Core Transactional Database) แบบ Realtime
                </h4>
                <p className="text-teal-900 text-xs">
                  เมื่อคุณหรือระบบบันทึกข้อมูลตั๋วชั่งและบิลลงตารางใน Supabase Cloud ระบบเว็บแอปนี้จะอัปเดตข้อมูลขึ้นหน้าจอและแจ้งเตือนเข้ากล่องพักรอชนบิลทันทีแบบ Realtime ผ่าน Supabase WebSocket
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Supabase Project URL:</label>
                  <input
                    type="text"
                    value={supabaseConfig.url}
                    onChange={e => setSupabaseConfig(prev => ({ ...prev, url: e.target.value }))}
                    placeholder="https://your-project-id.supabase.co"
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Supabase Anon Key:</label>
                  <input
                    type="password"
                    value={supabaseConfig.anonKey}
                    onChange={e => setSupabaseConfig(prev => ({ ...prev, anonKey: e.target.value }))}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono text-xs bg-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ชื่อตาราง (Table Name):</label>
                  <input
                    type="text"
                    value={supabaseConfig.tableName || 'bills_buffer'}
                    onChange={e => setSupabaseConfig(prev => ({ ...prev, tableName: e.target.value }))}
                    placeholder="bills_buffer"
                    className="w-full border border-slate-300 rounded-lg p-2 font-mono text-xs bg-white"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleTestSupabase}
                    className="w-full py-2 bg-teal-700 hover:bg-teal-600 text-white rounded-lg font-bold text-xs shadow-xs transition cursor-pointer flex items-center justify-center space-x-1.5"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>ทดสอบการเชื่อมต่อ & บันทึกค่า</span>
                  </button>
                </div>
              </div>

              {supabaseStatusMsg && (
                <div className={`p-3 rounded-lg text-xs font-semibold ${
                  isSupabaseConnected ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-rose-50 text-rose-800 border border-rose-300'
                }`}>
                  {supabaseStatusMsg}
                </div>
              )}

              {/* Cloud Sync Actions (when connected) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                    <Database className="w-4 h-4 text-blue-600" />
                    <span>จัดการข้อมูลบน Cloud Database (CRUD & Realtime):</span>
                  </span>
                  <span className="text-[11px] text-slate-500">
                    ข้อมูลในเครื่อง: {projects.length} โครงการ, {records.length} บิล, {buffer.length} กล่องพัก
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={handleBulkSyncToCloud}
                    disabled={isSyncing}
                    className="py-2 px-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg font-bold text-xs shadow-xs transition cursor-pointer flex items-center justify-center space-x-1.5"
                    title="นำข้อมูลโครงการและบิลทั้งหมดในเครื่องปัจจุบัน บันทึกขึ้น Supabase Cloud ทันที"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>{isSyncing ? 'กำลังซิงค์...' : '🚀 อัปโหลดข้อมูลในเครื่องขึ้น Supabase'}</span>
                  </button>
                  <button
                    onClick={handlePullFromCloud}
                    disabled={isSyncing}
                    className="py-2 px-3 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-400 text-white rounded-lg font-bold text-xs shadow-xs transition cursor-pointer flex items-center justify-center space-x-1.5"
                    title="ดึงข้อมูลล่าสุดทั้งหมดจาก Supabase Cloud มาแสดงผลในตาราง"
                  >
                    <DownloadCloud className="w-4 h-4 text-cyan-400" />
                    <span>{isSyncing ? 'กำลังโหลด...' : '📥 ดึงข้อมูลทั้งหมดจาก Cloud'}</span>
                  </button>
                </div>
              </div>

              {/* SQL Schema for Supabase */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="font-bold text-slate-700 text-xs">
                    คำสั่ง SQL สำหรับ Supabase SQL Editor (สร้าง 3 ตาราง: projects, reconciliation_records, bills_buffer):
                  </label>
                  <button
                    onClick={() => copyToClipboard(SUPABASE_SQL_SCHEMA, 'supabase_sql')}
                    className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-bold flex items-center space-x-1 cursor-pointer"
                  >
                    {copied === 'supabase_sql' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied === 'supabase_sql' ? 'คัดลอก SQL แล้ว' : 'คัดลอก SQL (3 ตาราง)'}</span>
                  </button>
                </div>
                <pre className="bg-slate-900 text-slate-200 p-3 rounded-xl font-mono text-[10px] overflow-x-auto max-h-48 leading-relaxed border border-slate-700">
{SUPABASE_SQL_SCHEMA}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-100 border-t border-slate-200 flex justify-between items-center shrink-0">
          <div className="text-slate-500 text-[11px]">
            โฟลเดอร์เป้าหมาย: <a href={folderUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline font-mono">{folderId}</a> (BTC_Purchasing_Receipts)
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold transition cursor-pointer"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
};
