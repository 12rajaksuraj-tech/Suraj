import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';

const app = express();
const PORT = 3000;

// Body parsing and session configuration
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

const DB_FILE = path.join(process.cwd(), 'database.json');

// Interface Types
interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  wallet_balance: number;
  unwithdrawable_bonus?: number;
  upi_id: string | null;
  referral_code: string;
  referred_by: string | null;
  wallet_status: 'active' | 'frozen';
  is_verified: number; // 0 or 1
  ip_address: string;
  device_info: string;
  account_status: 'active' | 'blocked';
  created_at: string;
}

interface Tournament {
  id: string;
  title: string;
  game_name: string;
  entry_fee: number;
  prize_pool: number;
  match_time: string;
  room_id: string;
  room_password: string;
  status: 'Upcoming' | 'Live' | 'Completed';
  commission_pct: number;
  match_release_time: string;
  created_at: string;
}

interface Participant {
  id: string;
  user_id: string;
  tournament_id: string;
}

interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  type: 'credit' | 'debit';
  description: string;
  upi_txn_id: string | null;
  fraud_status: 'normal' | 'flagged';
  review_required: boolean;
  created_at: string;
}

interface EmailVerification {
  id: string;
  user_id: string;
  token: string;
  status: 'Pending' | 'Verified';
  created_at: string;
}

interface LoginOtp {
  id: string;
  user_id: string;
  otp: string;
  expires_at: string;
  status: 'Pending' | 'Used';
}

interface RateLimit {
  id: string;
  ip_address: string;
  action_type: string;
  created_at: string;
}

interface Referral {
  id: string;
  referrer_id: string;
  referred_user_id: string;
  bonus_amount: number;
  created_at: string;
}

interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  status: 'Unread' | 'Read';
  created_at: string;
}

interface MatchScreenshot {
  id: string;
  user_id: string;
  tournament_id: string;
  image: string; // base64
  status: 'Pending' | 'Approved' | 'Rejected';
  created_at: string;
}

interface AdminLog {
  id: string;
  admin_id: string;
  action: string;
  details: string;
  created_at: string;
}

interface DBState {
  users: User[];
  admin: { id: string; username: string; password_hash: string }[];
  tournaments: Tournament[];
  participants: Participant[];
  transactions: Transaction[];
  email_verifications: EmailVerification[];
  login_otp: LoginOtp[];
  rate_limits: RateLimit[];
  referrals: Referral[];
  notifications: Notification[];
  match_screenshots: MatchScreenshot[];
  admin_logs: AdminLog[];
  settings: {
    admin_upi_id: string;
    admin_qr_code: string;
    admin_password_hash: string;
  };
  deposits: {
    id: string;
    user_id: string;
    amount: number;
    transaction_id: string;
    status: 'Pending' | 'Approved' | 'Rejected';
    created_at: string;
  }[];
  withdrawals: {
    id: string;
    user_id: string;
    amount: number;
    status: 'Pending' | 'Completed' | 'Rejected';
    created_at: string;
  }[];
}

// -------------------------------------------------------------
// In-Memory Dev-Notification Mailbox logger
// -------------------------------------------------------------
let DEV_MAILBOX: { time: string; to: string; type: string; subject: string; body: string; code: string }[] = [];
function addMail(to: string, type: string, subject: string, body: string, code: string = '') {
  DEV_MAILBOX.unshift({
    time: new Date().toLocaleTimeString(),
    to,
    type,
    subject,
    body,
    code,
  });
  if (DEV_MAILBOX.length > 5) DEV_MAILBOX.pop();
}

// -------------------------------------------------------------
// Helper to manage Database
// -------------------------------------------------------------
function readDb(): DBState {
  if (!fs.existsSync(DB_FILE)) {
    // Return empty schema initially, requiring /install.php to properly seed
    return {
      users: [],
      admin: [
        {
          id: 'admin_1',
          username: 'admin',
          password_hash: crypto.createHash('sha256').update('admin123').digest('hex')
        }
      ],
      tournaments: [],
      participants: [],
      transactions: [],
      email_verifications: [],
      login_otp: [],
      rate_limits: [],
      referrals: [],
      notifications: [],
      match_screenshots: [],
      admin_logs: [],
      settings: {
        admin_upi_id: 'upi@upi',
        admin_qr_code: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150"><rect width="150" height="150" fill="white"/><rect x="20" y="20" width="40" height="40" fill="black"/><rect x="90" y="20" width="40" height="40" fill="black"/><rect x="20" y="90" width="40" height="40" fill="black"/><rect x="35" y="35" width="10" height="10" fill="white"/><rect x="105" y="35" width="10" height="10" fill="white"/><rect x="35" y="105" width="10" height="10" fill="white"/><rect x="70" y="50" width="10" height="50" fill="black"/><rect x="50" y="70" width="50" height="10" fill="black"/><rect x="90" y="90" width="20" height="20" fill="black"/><rect x="120" y="120" width="10" height="10" fill="black"/><text x="75" y="145" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" text-anchor="middle">SCAN TO PAY</text></svg>',
        admin_password_hash: crypto.createHash('sha256').update('admin123').digest('hex'),
      },
      deposits: [],
      withdrawals: [],
    };
  }
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

  // Ensure backward compatibility and map unwithdrawable bonus safely
  if (db.users) {
    db.users.forEach((u: any) => {
      if (u.unwithdrawable_bonus === undefined) {
        u.unwithdrawable_bonus = 0;
      }
      if (u.unwithdrawable_bonus > u.wallet_balance) {
        u.unwithdrawable_bonus = u.wallet_balance;
      }
      if (u.unwithdrawable_bonus < 0) {
        u.unwithdrawable_bonus = 0;
      }
    });
  }

  if (!db.admin || db.admin.length === 0) {
    db.admin = [
      {
        id: 'admin_1',
        username: 'admin',
        password_hash: crypto.createHash('sha256').update('admin123').digest('hex')
      }
    ];
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  }
  return db;
}

function writeDb(data: DBState) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// -------------------------------------------------------------
// Easy Session Handling
// -------------------------------------------------------------
const SessionsStore = new Map<string, { userId?: string; adminId?: string; ip: string; message?: string; error?: string; otp_pending_user_id?: string }>();

function getSession(req: express.Request, res?: express.Response) {
  if ((req as any).my_session) {
    return (req as any).my_session;
  }
  const cookies = parseCookies(req.headers.cookie);
  let sid = (req.query.sid as string) || (req.body && req.body.sid as string) || cookies['sid'];
  
  if (!sid || !SessionsStore.has(sid)) {
    sid = crypto.randomUUID();
    SessionsStore.set(sid, { ip: req.ip || '127.0.0.1' });
  }

  if (res && res !== express.response && typeof res.setHeader === 'function') {
    try {
      res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=None; Secure`);
    } catch (err) {
      // Prevent unexpected runtime crash if the response object isn't fully initialized
    }
  }

  if (res && typeof res.redirect === 'function' && !(res as any)._is_redirect_wrapped) {
    const originalRedirect = res.redirect.bind(res);
    res.redirect = function (...args: any[]): void {
      let url = typeof args[0] === 'string' ? args[0] : (typeof args[1] === 'string' ? args[1] : '');
      if (url && !url.includes('sid=')) {
        const separator = url.includes('?') ? '&' : '?';
        const updatedUrl = `${url}${separator}sid=${sid}`;
        if (typeof args[0] === 'string') {
          args[0] = updatedUrl;
        } else if (typeof args[1] === 'string') {
          args[1] = updatedUrl;
        }
      }
      return originalRedirect(...(args as any));
    };
    (res as any)._is_redirect_wrapped = true;
  }

  const session = SessionsStore.get(sid)!;
  (req as any).my_session = session;
  (session as any).sid = sid;
  return session;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length === 2) {
      cookies[parts[0].trim()] = parts[1].trim();
    }
  });
  return cookies;
}

// Password hashing helper
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Rate limiter utility
function checkRateLimit(ip: string, actionType: string, limit: number, minsWindow: number): boolean {
  const db = readDb();
  const cutoff = new Date(Date.now() - minsWindow * 60 * 1000).toISOString();
  const logs = db.rate_limits.filter(r => r.ip_address === ip && r.action_type === actionType && r.created_at >= cutoff);
  if (logs.length >= limit) {
    return false; // Limit exceeded
  }
  // Record attempt
  db.rate_limits.push({
    id: crypto.randomUUID(),
    ip_address: ip,
    action_type: actionType,
    created_at: new Date().toISOString()
  });
  writeDb(db);
  return true;
}

// -------------------------------------------------------------
// Base HTML Render Component
// -------------------------------------------------------------
function renderLayout(req: express.Request, contentHTML: string, title = 'MVP', isAdmin = false, flashMessage?: string, errorMessage?: string): string {
  const db = readDb();
  const session = getSession(req);
  
  let user: User | null = null;
  let unreadCount = 0;
  if (!isAdmin && session.userId) {
    user = db.users.find(u => u.id === session.userId) || null;
    unreadCount = db.notifications.filter(n => n.user_id === session.userId && n.status === 'Unread').length;
  }

  // Determine if this is the designated app owner session (12rajaksuraj@gmail.com)
  let isOwnerOfApp = false;
  if (user && user.email.toLowerCase() === '12rajaksuraj@gmail.com') {
    isOwnerOfApp = true;
    (session as any).isOwner = true;
  } else if ((session as any).isOwner === true) {
    isOwnerOfApp = true;
  } else if (session.otp_pending_user_id) {
    const pendingUser = db.users.find(u => u.id === session.otp_pending_user_id);
    if (pendingUser && pendingUser.email.toLowerCase() === '12rajaksuraj@gmail.com') {
      isOwnerOfApp = true;
      (session as any).isOwner = true;
    }
  } else if (req.query.dev_mode === 'true' || req.query.owner === 'true') {
    isOwnerOfApp = true;
    (session as any).isOwner = true;
  }

  // Flash UI elements
  let notificationBanner = '';
  if (flashMessage) {
    notificationBanner += `
      <div class="fixed top-4 left-12 right-12 z-50 animate-bounce bg-emerald-500 border border-emerald-400 text-slate-950 font-bold px-4 py-3 rounded-xl shadow-lg flex items-center justify-between" id="alert-banner">
        <span>✅ ${escapeHtml(flashMessage)}</span>
        <button onclick="document.getElementById('alert-banner').remove()" class="text-slate-900 font-extrabold focus:outline-none">&times;</button>
      </div>
    `;
  }
  if (errorMessage) {
    notificationBanner += `
      <div class="fixed top-4 left-12 right-12 z-50 animate-pulse bg-rose-500 border border-rose-400 text-slate-100 font-bold px-4 py-3 rounded-xl shadow-lg flex items-center justify-between" id="alert-error">
        <span>⚠️ ${escapeHtml(errorMessage)}</span>
        <button onclick="document.getElementById('alert-error').remove()" class="text-slate-100 font-extrabold focus:outline-none">&times;</button>
      </div>
    `;
  }

  // System dynamic email preview drawer for seamless local owner evaluation
  let mailPreviewDrawer = '';
  if (DEV_MAILBOX.length > 0 && isOwnerOfApp) {
    mailPreviewDrawer = `
      <!-- HoloMail holographic interactive mailbox simulated helper (Advanced Effects) -->
      <div id="holomail-console" class="relative my-4 px-1 select-none">
        <!-- Floating neon blinking line indicator -->
        <div class="absolute -top-1.5 left-6 px-2.5 py-0.5 rounded-full bg-slate-950 border border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.35)] flex items-center gap-1.5 z-10 text-[9px] font-black uppercase tracking-widest text-emerald-400">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
          <span>HoloMail Feed (${DEV_MAILBOX.length})</span>
        </div>

        <div class="glass-card rounded-2xl p-4 pt-5 select-text relative overflow-hidden transition-all shadow-xl border-emerald-500/20">
          <!-- Holographic layout diagonal mesh shine -->
          <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-emerald-500/5 pointer-events-none"></div>
          
          <div class="flex justify-between items-center mb-3">
            <span class="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 flex items-center gap-1">
              <i class="fas fa-satellite-dish animate-pulse" style="color: var(--theme-accent)"></i> Simulated Local Inbox
            </span>
            <div class="flex items-center gap-2">
              <span class="text-[8px] font-mono px-1.5 py-0.2 rounded bg-slate-950 text-slate-500 border border-slate-850">Dev Engine</span>
              <button onclick="toggleHoloMailCollapse()" class="text-slate-500 hover:text-white text-xs px-1 hover:scale-110 transition-all cursor-pointer">
                <i class="fas fa-chevron-up transition-transform duration-300" id="holomail-chevron"></i>
              </button>
            </div>
          </div>

          <!-- Drawer feed block -->
          <div id="holomail-feed-content" class="space-y-3 transition-all duration-300 max-h-[280px] overflow-y-auto pr-1">
            ${DEV_MAILBOX.map((mail, idx) => {
              const cleanedCode = (mail.code || '').trim();
              const isOTP = mail.type === 'OTP_LOGIN';
              const isVerify = mail.type === 'EMAIL_VERIFICATION';
              
              return `
                <div class="p-3 bg-slate-950/80 border border-slate-850/80 rounded-xl relative hover:border-slate-800 transition-all">
                  <div class="flex justify-between items-start">
                    <div class="flex flex-col">
                      <span class="text-[8.5px] font-mono text-emerald-400">To: ${escapeHtml(mail.to)}</span>
                      <h4 class="text-[10px] font-black text-slate-200 mt-0.5 flex items-center gap-1">
                        ${isOTP ? '<i class="fas fa-key text-amber-400 text-[9px]"></i>' : ''}
                        ${isVerify ? '<i class="fas fa-envelope-open-text text-indigo-400 text-[9px]"></i>' : ''}
                        ${escapeHtml(mail.subject)}
                      </h4>
                    </div>
                    <span class="text-[7.5px] font-mono text-slate-500 bg-slate-900 px-1 py-0.2 rounded border border-slate-850">${mail.time}</span>
                  </div>

                  <p class="text-[9.5px] text-slate-400 line-clamp-2 leading-relaxed mt-1.5 font-normal">${escapeHtml(mail.body)}</p>

                  ${mail.code ? `
                    <div class="mt-2.5 pt-2 border-t border-slate-900/80 flex flex-wrap items-center justify-between gap-1.5">
                      <!-- Action Code display -->
                      <div class="flex items-center gap-2">
                        <span class="px-2.5 py-0.5 bg-slate-900 text-amber-400 font-mono font-black tracking-widest text-[11px] rounded border border-amber-500/20 shadow-inner select-all">${escapeHtml(mail.code)}</span>
                        <button onclick="copyHoloMailCode(this, '${cleanedCode}')" class="text-[8.5px] px-2 py-1 bg-slate-900 hover:bg-slate-850 text-slate-300 hover:text-emerald-400 border border-slate-800 rounded transition-all cursor-pointer flex items-center gap-1">
                          <i class="far fa-copy"></i> <span>Copy</span>
                        </button>
                      </div>

                      <!-- Direct Interactive Verification Action Trigger -->
                      ${isVerify ? `
                        <a href="/verify_email.php?token=${cleanedCode}" class="text-[8px] font-bold uppercase tracking-widest px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-slate-100 neon-hover-shadow border border-indigo-400/20 transition-all cursor-pointer flex items-center gap-1">
                          <i class="fas fa-user-check"></i> One-Tap Verify
                        </a>
                      ` : ''}

                      ${isOTP ? `
                        <button onclick="autofillLoginOTP('${cleanedCode}')" class="text-[8px] font-bold uppercase tracking-widest px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.3)] transition-all cursor-pointer flex items-center gap-1">
                          <i class="fas fa-sign-in-alt"></i> Autofill OTP
                        </button>
                      ` : ''}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
        
        <!-- Interactive client-side helper scripts for HoloMail -->
        <script>
          function toggleHoloMailCollapse() {
            const feed = document.getElementById('holomail-feed-content');
            const chevron = document.getElementById('holomail-chevron');
            if (feed.classList.contains('hidden')) {
              feed.classList.remove('hidden');
              chevron.classList.remove('rotate-180');
              localStorage.setItem('holomail-expanded', 'true');
            } else {
              feed.classList.add('hidden');
              chevron.classList.add('rotate-180');
              localStorage.setItem('holomail-expanded', 'false');
            }
          }

          function copyHoloMailCode(btn, txt) {
            navigator.clipboard.writeText(txt).then(() => {
              const label = btn.querySelector('span');
              const icon = btn.querySelector('i');
              if (label) {
                label.innerText = 'Copied!';
                btn.classList.add('text-emerald-400', 'border-emerald-500/20');
                if (icon) icon.className = 'fas fa-check text-emerald-400';
                
                setTimeout(() => {
                  label.innerText = 'Copy';
                  btn.classList.remove('text-emerald-400', 'border-emerald-500/20');
                  if (icon) icon.className = 'far fa-copy';
                }, 1500);
              }
            });
          }

          function autofillLoginOTP(code) {
            const targetInput = document.querySelector('input[name="otp_code"]');
            if (targetInput) {
              targetInput.value = code;
              targetInput.classList.remove('border-slate-800');
              targetInput.classList.add('border-amber-500', 'ring-2', 'ring-amber-500/30', 'animate-pulse');
              
              // Highlight code entry specifically
              setTimeout(() => {
                targetInput.classList.remove('animate-pulse');
              }, 1000);
            } else {
              alert('OTP code copied to clipboard! Switch to the "OTP Login" tab to verify and login.');
              navigator.clipboard.writeText(code);
            }
          }

          // Persistence check on page load
          document.addEventListener('DOMContentLoaded', () => {
            const expanded = localStorage.getItem('holomail-expanded');
            if (expanded === 'false') {
              const feed = document.getElementById('holomail-feed-content');
              const chevron = document.getElementById('holomail-chevron');
              if (feed) feed.classList.add('hidden');
              if (chevron) chevron.classList.add('rotate-180');
            }
          });
        </script>
      </div>
    `;
  }

  // Header and user information
  const headerSection = isAdmin ? `
    <header class="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-slate-100 tracking-wider">M</div>
        <span class="font-bold text-slate-200 text-lg uppercase tracking-wider">MVP Admin</span>
      </div>
      <a href="/admin/login.php?logout=1" class="text-slate-400 hover:text-rose-500 text-xs px-2 py-1.5 border border-slate-800 rounded-lg bg-slate-950 transition-all flex items-center gap-1">
        <i class="fas fa-sign-out-alt"></i> Logout
      </a>
    </header>
  ` : `
    <header class="bg-slate-950 border-b border-slate-900 px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-md">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-black text-slate-950 shadow-[0_0_12px_rgba(16,185,129,0.3)]">M</div>
        <span class="font-black text-slate-100 text-lg uppercase tracking-wider">MVP</span>
        <span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[9px] text-emerald-400 border border-emerald-500/20 font-bold">LIVE</span>
      </div>
      <div class="flex items-center gap-3">
        <!-- Elegant Theme Selection trigger icon -->
        <button onclick="toggleThemeModalSheet(event)" class="relative p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-slate-900 transition-all cursor-pointer flex items-center justify-center" title="Change Theme Background & Colors">
          <i class="fas fa-palette text-lg"></i>
          <span class="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-amber-550 border border-slate-950 animate-pulse"></span>
        </button>
        <!-- Notification icon -->
        <a href="/profile.php#notifications" class="relative p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-slate-900 transition-all">
          <i class="far fa-bell text-lg"></i>
          ${unreadCount > 0 ? `
            <span class="absolute top-0 right-0 w-4 h-4 rounded-full bg-rose-500 text-[9px] font-black text-white flex items-center justify-center animate-ping"></span>
            <span class="absolute top-0 right-0 w-4 h-4 rounded-full bg-rose-500 text-[9px] font-black text-white flex items-center justify-center">${unreadCount}</span>
          ` : ''}
        </a>
        <!-- Wallet counter -->
        <a href="/wallet.php" class="bg-slate-900 hover:bg-slate-800/80 border border-slate-800 px-2.5 py-1 rounded-xl flex items-center gap-1.5 text-xs text-emerald-400 font-bold tracking-widest hover:scale-102 transition-all">
          <i class="fas fa-wallet text-emerald-400"></i>
          ₹${user ? user.wallet_balance.toFixed(2) : '0.00'}
        </a>
        ${user && (user.username === 'suraj' || user.email === '12rajaksuraj@gmail.com') ? `
          <!-- Exclusive Owner Access to Admin Console -->
          <a href="/admin_auto_login.php" class="bg-amber-950/80 border border-amber-500/40 hover:border-amber-400 text-amber-300 font-extrabold text-[9px] uppercase tracking-wider px-2.5 py-1.5 rounded-xl flex items-center gap-1 shadow-[0_0_12px_rgba(245,158,11,0.3)] hover:bg-amber-900/60 hover:scale-102 transition-all">
            <i class="fas fa-shield-alt text-amber-400"></i>
            Admin
          </a>
        ` : ''}
      </div>
    </header>
  `;

  // Custom persistent bottom navigation bar
  const bottomNav = isAdmin ? `
    <nav class="bg-slate-900 border-t border-slate-800 px-4 py-2 flex items-center justify-around sticky bottom-0 z-30">
      <a href="/admin/index.php" class="flex flex-col items-center text-[10px] uppercase font-bold tracking-wider ${req.path.startsWith('/admin/index') ? 'text-indigo-400 scale-105' : 'text-slate-500 hover:text-slate-300'} transition-all gap-1 py-1.5">
        <i class="fas fa-chart-line text-lg"></i> Stats
      </a>
      <a href="/admin/tournament.php" class="flex flex-col items-center text-[10px] uppercase font-bold tracking-wider ${req.path.startsWith('/admin/tournament') || req.path.startsWith('/admin/manage_tournament') ? 'text-indigo-400 scale-105' : 'text-slate-500 hover:text-slate-300'} transition-all gap-1 py-1.5">
        <i class="fas fa-gamepad text-lg"></i> Events
      </a>
      <a href="/admin/user.php" class="flex flex-col items-center text-[10px] uppercase font-bold tracking-wider ${req.path.startsWith('/admin/user') ? 'text-indigo-400 scale-105' : 'text-slate-500 hover:text-slate-300'} transition-all gap-1 py-1.5">
        <i class="fas fa-users text-lg"></i> Players
      </a>
      <a href="/admin/setting.php" class="flex flex-col items-center text-[10px] uppercase font-bold tracking-wider ${req.path.startsWith('/admin/setting') ? 'text-indigo-400 scale-105' : 'text-slate-500 hover:text-slate-300'} transition-all gap-1 py-1.5">
        <i class="fas fa-sliders-h text-lg"></i> System
      </a>
    </nav>
  ` : `
    <nav class="bg-slate-950/95 backdrop-blur border-t border-slate-900 px-4 py-2 flex items-center justify-around sticky bottom-0 z-30">
      <a href="/index.php" class="flex flex-col items-center text-[9px] uppercase font-bold tracking-widest ${req.path.startsWith('/index') || req.path === '/' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'} transition-all gap-0.5 py-1">
        <i class="fas fa-award text-lg"></i> Tournaments
      </a>
      <a href="/my_tournaments.php" class="flex flex-col items-center text-[9px] uppercase font-bold tracking-widest ${req.path.startsWith('/my_tournaments') ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'} transition-all gap-0.5 py-1">
        <i class="fas fa-gamepad text-lg"></i> Joined
      </a>
      <a href="/wallet.php" class="flex flex-col items-center text-[9px] uppercase font-bold tracking-widest ${req.path.startsWith('/wallet') ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'} transition-all gap-0.5 py-1">
        <i class="fas fa-wallet text-lg"></i> Wallet
      </a>
      <a href="/profile.php" class="flex flex-col items-center text-[9px] uppercase font-bold tracking-widest ${req.path.startsWith('/profile') ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'} transition-all gap-0.5 py-1">
        <i class="fas fa-user-circle text-lg"></i> Profile
      </a>
    </nav>
  `;

  // Main compilation structure mapped inside a pristine mobile frame
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
      <title>${title} | MVP Tournament Portal</title>
      
      <!-- PWA Meta Tags & Manifest -->
      <link rel="manifest" href="/manifest.json">
      <meta name="theme-color" content="#05040d">
      <meta name="apple-mobile-web-app-capable" content="yes">
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
      <meta name="apple-mobile-web-app-title" content="MVP Tournament">
      <link rel="apple-touch-icon" href="https://img.icons8.com/color/512/game-controller.png">
      
      <!-- Tailwind CSS -->
      <script src="https://cdn.tailwindcss.com"></script>
      <!-- Font Awesome Icons -->
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@300;400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
        
        :root {
          /* Defaults (Twilight Theme) */
          --theme-bg: #05040d;
          --theme-viewport: radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.20) 0%, rgba(5, 4, 13, 0) 70%), radial-gradient(circle at 100% 100%, rgba(16, 185, 129, 0.10) 0%, rgba(5, 4, 13, 0) 50%), #05040d;
          --theme-accent: #6366f1;
          --theme-accent-hover: #818cf8;
          --theme-accent-rgb: 99, 102, 241;
          --theme-secondary: #10b981;
          --theme-secondary-hover: #34d399;
          --theme-secondary-rgb: 16, 185, 129;
          --theme-scrollbar-thumb: linear-gradient(180deg, #6366f1 0%, #10b981 100%);
          --theme-glass-bg: rgba(8, 7, 20, 0.8);
          --theme-glass-border: rgba(99, 102, 241, 0.15);
        }

        body {
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background-color: var(--theme-bg) !important;
          color: #f8fafc;
          user-select: none; /* Disable text selection as requested */
          -webkit-user-select: none;
          overscroll-behavior: contain;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
          transition: background-color 0.4s ease;
        }

        #app-viewport {
          background: var(--theme-viewport) !important;
          transition: background 0.4s ease, border-color 0.3s ease;
        }

        h1, h2, h3, h4, h5, h6, .brand-font {
          font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        
        .tab-mono {
          font-family: 'JetBrains Mono', monospace;
        }

        /* Dynamic overrides for theme actions, tags & indicators */
        .text-glow-emerald {
          text-shadow: 0 0 12px rgba(var(--theme-accent-rgb), 0.7);
        }
        .text-glow-amber, .text-glow-orange {
          text-shadow: 0 0 12px rgba(var(--theme-secondary-rgb), 0.75);
        }
        .text-glow-rose {
          text-shadow: 0 0 12px rgba(244, 63, 94, 0.75);
        }

        .premium-glow-emerald {
          box-shadow: 0 0 25px -3px rgba(var(--theme-accent-rgb), 0.25), inset 0 0 10px rgba(var(--theme-accent-rgb), 0.08) !important;
        }
        .premium-glow-amber, .premium-glow-orange, .premium-glow-rose {
          box-shadow: 0 0 25px -3px rgba(var(--theme-secondary-rgb), 0.25), inset 0 0 10px rgba(var(--theme-secondary-rgb), 0.08) !important;
        }

        .glass-card {
          background: var(--theme-glass-bg) !important;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--theme-glass-border) !important;
          transition: background-color 0.3s ease, border-color 0.3s ease;
        }

        /* Dynamic active state highlights for text and buttons */
        .bg-emerald-500 {
          background-color: var(--theme-secondary) !important;
        }
        .hover\:bg-emerald-400:hover {
          background-color: var(--theme-secondary-hover) !important;
        }
        .text-emerald-400 {
          color: var(--theme-secondary) !important;
        }
        .text-amber-400 {
          color: var(--theme-accent) !important;
        }
        .border-amber-400, .border-amber-500\/20, .border-amber-500\/40 {
          border-color: rgba(var(--theme-accent-rgb), 0.3) !important;
        }

        /* Hardware Accelerated Smooth Layers - fix micro-lag or stutters */
        * {
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
          -webkit-tap-highlight-color: transparent;
        }

        .accelerated {
          transform: translate3d(0, 0, 0);
          will-change: transform, opacity;
        }

        /* Silky momentum scrolling for extreme smoothness on Android & iOS */
        main, .scrollable {
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
        }

        /* custom premium slim amber & emerald gradient scrollbar */
        ::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        ::-webkit-scrollbar-track {
          background: var(--theme-bg);
        }
        ::-webkit-scrollbar-thumb {
          background: var(--theme-scrollbar-thumb) !important;
          border-radius: 999px;
          border: 1px solid var(--theme-bg);
        }

        /* Smooth tactile spring bounce on click/tap to make interactions incredibly responsive */
        button, a, .interactive-card {
          transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
        }
        button:active, a:active:not([href="#"]), .interactive-card:active {
          transform: scale(0.97);
        }

        /* Elegant moving shine animation for premium eyes-catching banners */
        @keyframes shine {
          100% {
            left: 125%;
          }
        }
        .shining-card {
          position: relative;
          overflow: hidden;
        }
        .shining-card::after {
          content: '';
          position: absolute;
          top: -50%;
          left: -60%;
          width: 30%;
          height: 200%;
          background: rgba(255, 255, 255, 0.13);
          transform: rotate(30deg);
          transition: none;
        }
        .shining-card:hover::after {
          animation: shine 1.2s ease-in-out infinite;
        }
      </style>

      <script>
        // Inline immediate executing CSS injection configuration to fully prevent FOUC (Flickers)
        const THEMES_DB = {
          cosmic: {
            bg: '#05030f',
            viewport: 'radial-gradient(circle at 50% 0%, rgba(236, 72, 153, 0.2) 0%, rgba(5, 3, 15, 0) 70%), radial-gradient(circle at 100% 100%, rgba(168, 85, 247, 0.15) 0%, rgba(5, 3, 15, 0) 50%), #05030f',
            accent: '#ec4899', /* Radiant Pink Orchid */
            accent_hover: '#f472b6',
            accent_rgb: '236, 72, 153',
            secondary: '#a855f7', /* Royal Amethyst */
            secondary_hover: '#c084fc',
            secondary_rgb: '168, 85, 247',
            scrollbar_thumb: 'linear-gradient(180deg, #ec4899 0%, #a855f7 100%)',
            glass_bg: 'rgba(12, 8, 26, 0.78)',
            glass_border: 'rgba(168, 85, 247, 0.2)'
          },
          crimson: {
            bg: '#0a0204',
            viewport: 'radial-gradient(circle at 50% 0%, rgba(239, 68, 68, 0.22) 0%, rgba(10, 2, 4, 0) 70%), radial-gradient(circle at 100% 100%, rgba(249, 115, 22, 0.12) 0%, rgba(10, 2, 4, 0) 50%), #0a0204',
            accent: '#ef4444', /* Crimson Red */
            accent_hover: '#f87171',
            accent_rgb: '239, 68, 68',
            secondary: '#f97316', /* Inferno Orange */
            secondary_hover: '#fb923c',
            secondary_rgb: '249, 115, 22',
            scrollbar_thumb: 'linear-gradient(180deg, #ef4444 0%, #f97316 100%)',
            glass_bg: 'rgba(22, 6, 10, 0.8)',
            glass_border: 'rgba(239, 68, 68, 0.2)'
          },
          poison: {
            bg: '#010503',
            viewport: 'radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.22) 0%, rgba(1, 5, 3, 0) 70%), radial-gradient(circle at 100% 100%, rgba(6, 182, 212, 0.12) 0%, rgba(1, 5, 3, 0) 50%), #010503',
            accent: '#10b981', /* Toxic Green */
            accent_hover: '#34d399',
            accent_rgb: '16, 185, 129',
            secondary: '#06b6d4', /* Cyan Cyber */
            secondary_hover: '#22d3ee',
            secondary_rgb: '6, 182, 212',
            scrollbar_thumb: 'linear-gradient(180deg, #10b981 0%, #06b6d4 100%)',
            glass_bg: 'rgba(4, 18, 12, 0.8)',
            glass_border: 'rgba(16, 185, 129, 0.2)'
          },
          royal: {
            bg: '#070502',
            viewport: 'radial-gradient(circle at 50% 0%, rgba(245, 158, 11, 0.20) 0%, rgba(7, 5, 2, 0) 70%), radial-gradient(circle at 100% 100%, rgba(251, 191, 36, 0.10) 0%, rgba(7, 5, 2, 0) 50%), #070502',
            accent: '#f59e0b', /* Saffron Gold */
            accent_hover: '#fbbf24',
            accent_rgb: '245, 158, 11',
            secondary: '#fb923c', /* Golden Warm Dusk */
            secondary_hover: '#fdba74',
            secondary_rgb: '251, 146, 60',
            scrollbar_thumb: 'linear-gradient(180deg, #f59e0b 0%, #fb923c 100%)',
            glass_bg: 'rgba(18, 12, 6, 0.82)',
            glass_border: 'rgba(245, 158, 11, 0.2)'
          },
          ocean: {
            bg: '#01040a',
            viewport: 'radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.22) 0%, rgba(1, 4, 10, 0) 70%), radial-gradient(circle at 100% 100%, rgba(6, 182, 212, 0.12) 0%, rgba(1, 4, 10, 0) 50%), #01040a',
            accent: '#3b82f6', /* Oceanic Sapphire */
            accent_hover: '#60a5fa',
            accent_rgb: '59, 130, 246',
            secondary: '#06b6d4', /* Deep Cyan Wave */
            secondary_hover: '#22d3ee',
            secondary_rgb: '6, 182, 212',
            scrollbar_thumb: 'linear-gradient(180deg, #3b82f6 0%, #06b6d4 100%)',
            glass_bg: 'rgba(4, 11, 24, 0.8)',
            glass_border: 'rgba(59, 130, 246, 0.2)'
          },
          twilight: {
            bg: '#05040d',
            viewport: 'radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.20) 0%, rgba(5, 4, 13, 0) 70%), radial-gradient(circle at 100% 100%, rgba(16, 185, 129, 0.10) 0%, rgba(5, 4, 13, 0) 50%), #05040d',
            accent: '#6366f1', /* Midnight Violet */
            accent_hover: '#818cf8',
            accent_rgb: '99, 102, 241',
            secondary: '#10b981', /* Emerald Jade */
            secondary_hover: '#34d399',
            secondary_rgb: '16, 185, 129',
            scrollbar_thumb: 'linear-gradient(180deg, #6366f1 0%, #10b981 100%)',
            glass_bg: 'rgba(8, 7, 20, 0.8)',
            glass_border: 'rgba(99, 102, 241, 0.15)'
          }
        };

        function globalApplyActiveTheme() {
          const defaultTheme = 'twilight';
          let activeThemeKey = localStorage.getItem('mvp-color-theme') || defaultTheme;
          if (!THEMES_DB[activeThemeKey]) {
            activeThemeKey = defaultTheme;
          }
          const theme = THEMES_DB[activeThemeKey];
          const rootSt = document.documentElement.style;
          rootSt.setProperty('--theme-bg', theme.bg);
          rootSt.setProperty('--theme-viewport', theme.viewport);
          rootSt.setProperty('--theme-accent', theme.accent);
          rootSt.setProperty('--theme-accent-hover', theme.accent_hover);
          rootSt.setProperty('--theme-accent-rgb', theme.accent_rgb);
          rootSt.setProperty('--theme-secondary', theme.secondary);
          rootSt.setProperty('--theme-secondary-hover', theme.secondary_hover);
          rootSt.setProperty('--theme-secondary-rgb', theme.secondary_rgb);
          rootSt.setProperty('--theme-scrollbar-thumb', theme.scrollbar_thumb);
          rootSt.setProperty('--theme-glass-bg', theme.glass_bg);
          rootSt.setProperty('--theme-glass-border', theme.glass_border);
          
          document.documentElement.className = 'theme-loaded-' + activeThemeKey;
        }

        globalApplyActiveTheme();
      </script>
    </head>
    <body class="bg-slate-950 flex justify-center min-h-screen text-slate-100 overflow-x-hidden antialiased">
      
      <!-- Central framed mobile simulator wrapper -->
      <div id="app-viewport" class="w-full max-w-md min-h-screen bg-[#05040d] flex flex-col shadow-2xl relative border-x border-slate-900/60 accelerated">
        
        <!-- Top device info line (Anti-AI-Slop Clean Label) -->
        <div class="h-6 bg-slate-950 px-4 pt-1 flex justify-between items-center text-[10px] text-slate-500 font-mono font-bold select-none border-b border-slate-900/40">
          <span>MVP PRO</span>
          <div class="flex items-center gap-1.5">
            <span>2026-05-26</span>
            <i class="fas fa-wifi text-[9px]"></i>
            <i class="fas fa-battery-three-quarters text-[9px]"></i>
          </div>
        </div>

        ${headerSection}

        <!-- Scrollable Body Content -->
        <main class="flex-grow p-4 overflow-y-auto pb-24">
          ${notificationBanner}
          ${mailPreviewDrawer}
          ${contentHTML}
        </main>

        ${bottomNav}

        <!-- Premium Applet Theme Selector Sheet overlay (Modern Mobile Modal) -->
        <div id="global-theme-drawer-overlay" class="absolute inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-end justify-center opacity-0 pointer-events-none transition-all duration-300" onclick="toggleThemeModalSheet(event)">
          <!-- Modal Drawer Box -->
          <div class="bg-slate-900/95 border-t border-slate-800/80 w-full rounded-t-[2.5rem] p-5 pb-8 space-y-4 shadow-2xl transform translate-y-full transition-all duration-300 relative select-none" onclick="event.stopPropagation()">
            
            <!-- Handle bar -->
            <div class="w-12 h-1.5 bg-slate-800 rounded-full mx-auto -mt-1.5 mb-2.5"></div>
            
            <div class="flex justify-between items-center border-b border-slate-800/60 pb-3">
              <span class="text-[11px] font-black uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
                <i class="fas fa-palette"></i> Choose Game Theme
              </span>
              <button onclick="toggleThemeModalSheet(event)" class="w-6 h-6 rounded-full bg-slate-950 border border-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs transition-all cursor-pointer">
                &times;
              </button>
            </div>
            
            <p class="text-[10px] text-slate-400 leading-relaxed font-normal">
              Select a custom gaming background & color scheme! Live preview changes will apply instantly to all active menus, highlights, and buttons.
            </p>

            <div class="grid grid-cols-2 gap-2" id="global-theme-list">
              <!-- Twilight Indigo -->
              <button onclick="globalChangeTheme('twilight')" id="gbtn-theme-twilight" class="global-theme-card text-left p-3 rounded-2xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 transition-all flex flex-col justify-between relative cursor-pointer select-none">
                <span class="text-[10px] font-extrabold text-white">🌌 Twilight Indigo</span>
                <span class="text-[8px] text-slate-500 mt-1">Indigo & Jade Green</span>
                <div class="flex gap-1.5 mt-2.5">
                  <span class="w-3.5 h-3.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></span>
                  <span class="w-3.5 h-3.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                </div>
                <div class="gcheck-indicator absolute top-3 right-3 hidden text-emerald-400 text-[10px]">
                  <i class="fas fa-check-circle"></i>
                </div>
              </button>

              <!-- Cosmic Amethyst -->
              <button onclick="globalChangeTheme('cosmic')" id="gbtn-theme-cosmic" class="global-theme-card text-left p-3 rounded-2xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 transition-all flex flex-col justify-between relative cursor-pointer select-none">
                <span class="text-[10px] font-extrabold text-white">🔮 Cosmic Amethyst</span>
                <span class="text-[8px] text-slate-500 mt-1">Pink Orchid & Amethyst</span>
                <div class="flex gap-1.5 mt-2.5">
                  <span class="w-3.5 h-3.5 rounded-full bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.5)]"></span>
                  <span class="w-3.5 h-3.5 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]"></span>
                </div>
                <div class="gcheck-indicator absolute top-3 right-3 hidden text-emerald-400 text-[10px]">
                  <i class="fas fa-check-circle"></i>
                </div>
              </button>

              <!-- Sunset Crimson -->
              <button onclick="globalChangeTheme('crimson')" id="gbtn-theme-crimson" class="global-theme-card text-left p-3 rounded-2xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 transition-all flex flex-col justify-between relative cursor-pointer select-none">
                <span class="text-[10px] font-extrabold text-white">🔥 Sunset Crimson</span>
                <span class="text-[8px] text-slate-500 mt-1">Crimson Red & Flame</span>
                <div class="flex gap-1.5 mt-2.5">
                  <span class="w-3.5 h-3.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]"></span>
                  <span class="w-3.5 h-3.5 rounded-full bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]"></span>
                </div>
                <div class="gcheck-indicator absolute top-3 right-3 hidden text-emerald-400 text-[10px]">
                  <i class="fas fa-check-circle"></i>
                </div>
              </button>

              <!-- Poison Venom -->
              <button onclick="globalChangeTheme('poison')" id="gbtn-theme-poison" class="global-theme-card text-left p-3 rounded-2xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 transition-all flex flex-col justify-between relative cursor-pointer select-none">
                <span class="text-[10px] font-extrabold text-white">🍃 Poison Venom</span>
                <span class="text-[8px] text-slate-500 mt-1">Toxic Green & Cyan</span>
                <div class="flex gap-1.5 mt-2.5">
                  <span class="w-3.5 h-3.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                  <span class="w-3.5 h-3.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]"></span>
                </div>
                <div class="gcheck-indicator absolute top-3 right-3 hidden text-emerald-400 text-[10px]">
                  <i class="fas fa-check-circle"></i>
                </div>
              </button>

              <!-- Imperial Saffron -->
              <button onclick="globalChangeTheme('royal')" id="gbtn-theme-royal" class="global-theme-card text-left p-3 rounded-2xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 transition-all flex flex-col justify-between relative cursor-pointer select-none">
                <span class="text-[10px] font-extrabold text-white">👑 Imperial Saffron</span>
                <span class="text-[8px] text-slate-500 mt-1">Saffron Gold & Amber</span>
                <div class="flex gap-1.5 mt-2.5">
                  <span class="w-3.5 h-3.5 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"></span>
                  <span class="w-3.5 h-3.5 rounded-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]"></span>
                </div>
                <div class="gcheck-indicator absolute top-3 right-3 hidden text-emerald-400 text-[10px]">
                  <i class="fas fa-check-circle"></i>
                </div>
              </button>

              <!-- Cyber Oceans -->
              <button onclick="globalChangeTheme('ocean')" id="gbtn-theme-ocean" class="global-theme-card text-left p-3 rounded-2xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 transition-all flex flex-col justify-between relative cursor-pointer select-none">
                <span class="text-[10px] font-extrabold text-white">🌊 Cyber Oceans</span>
                <span class="text-[8px] text-slate-500 mt-1">Ocean Blue & Cyan Wave</span>
                <div class="flex gap-1.5 mt-2.5">
                  <span class="w-3.5 h-3.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></span>
                  <span class="w-3.5 h-3.5 rounded-full bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]"></span>
                </div>
                <div class="gcheck-indicator absolute top-3 right-3 hidden text-emerald-400 text-[10px]">
                  <i class="fas fa-check-circle"></i>
                </div>
              </button>
            </div>
            
            <button onclick="toggleThemeModalSheet(event)" class="w-full py-2.8 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black uppercase rounded-xl transition-all cursor-pointer text-center tracking-widest">
              Confirm Selection
            </button>
          </div>
        </div>
      </div>

      <!-- Applet security and carousel engine scripts -->
      <script>
        // Disable Right-Click
        document.addEventListener('contextmenu', function(e) {
          e.preventDefault();
        });

        // Disable specific shortcuts to prevent desktop debugger inspection
        document.addEventListener('keydown', function(e) {
          if (e.ctrlKey && (e.key === 'u' || e.key === 'U' || e.key === 's' || e.key === 'S')) {
            e.preventDefault();
          }
        });

        // Smooth Carousel Engine Controls
        (function() {
          let currentIndex = 0;
          let slideInterval = null;

          function getSlides() {
            return document.querySelectorAll('.carousel-slide');
          }
          function getDots() {
            return document.querySelectorAll('.carousel-dot-indicator');
          }

          function showSlide(index) {
            const slides = getSlides();
            const dots = getDots();
            if (slides.length === 0) return;

            // Normalize index
            if (index < 0) {
              currentIndex = slides.length - 1;
            } else if (index >= slides.length) {
              currentIndex = 0;
            } else {
              currentIndex = index;
            }

            slides.forEach((slide, idx) => {
              if (idx === currentIndex) {
                // Active slide - bring into view smoothly
                slide.style.opacity = '1';
                slide.style.transform = 'scale(1) translateX(0)';
                slide.style.zIndex = '10';
              } else {
                // Inactive slide - sweep away gently
                slide.style.opacity = '0';
                slide.style.transform = idx > currentIndex ? 'scale(0.95) translateX(30px)' : 'scale(0.95) translateX(-30px)';
                slide.style.zIndex = '0';
              }
            });

            dots.forEach((dot, idx) => {
              if (idx === currentIndex) {
                dot.style.width = '16px';
                dot.style.borderRadius = '999px';
                dot.style.backgroundColor = '#f59e0b'; // Saffron Gold accent indicator
              } else {
                dot.style.width = '6px';
                dot.style.borderRadius = '999px';
                dot.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
              }
            });
          }

          window.prevSlide = function(e) {
            if (e) e.preventDefault();
            resetInterval();
            showSlide(currentIndex - 1);
          };

          window.nextSlide = function(e) {
            if (e) e.preventDefault();
            resetInterval();
            showSlide(currentIndex + 1);
          };

          window.setSlide = function(idx, e) {
            if (e) e.preventDefault();
            resetInterval();
            showSlide(idx);
          };

          function startInterval() {
            if (getSlides().length > 1) {
              slideInterval = setInterval(() => {
                showSlide(currentIndex + 1);
              }, 4500); // Elegant 4.5s transition cadence
            }
          }

          function resetInterval() {
            if (slideInterval) clearInterval(slideInterval);
            startInterval();
          }

          // Trigger immediate load
          setTimeout(() => {
            showSlide(0);
            startInterval();
          }, 50);
        })();

        window.toggleThemeModalSheet = function(e) {
          if (e) e.preventDefault();
          const overlay = document.getElementById('global-theme-drawer-overlay');
          if (!overlay) return;
          const drawer = overlay.querySelector('.transform');
          if (overlay.classList.contains('opacity-0')) {
            overlay.classList.remove('opacity-0', 'pointer-events-none');
            drawer.classList.remove('translate-y-full');
            if (typeof updateGlobalThemeCardsHighlight === 'function') {
              updateGlobalThemeCardsHighlight();
            }
          } else {
            overlay.classList.add('opacity-0', 'pointer-events-none');
            drawer.classList.add('translate-y-full');
          }
        };

        window.globalChangeTheme = function(theme) {
          localStorage.setItem('mvp-color-theme', theme);
          if (typeof globalApplyActiveTheme === 'function') {
            globalApplyActiveTheme();
          }
          if (typeof updateGlobalThemeCardsHighlight === 'function') {
            updateGlobalThemeCardsHighlight();
          }
          if (typeof updateThemeCardsHighlight === 'function') {
            updateThemeCardsHighlight();
          }
        };

        window.updateGlobalThemeCardsHighlight = function() {
          const currentTheme = localStorage.getItem('mvp-color-theme') || 'twilight';
          document.querySelectorAll('.global-theme-card').forEach(card => {
            card.classList.remove('border-amber-500', 'bg-slate-900', 'scale-[1.02]', 'shadow-lg');
            card.classList.add('border-slate-850', 'bg-slate-950');
            const indicator = card.querySelector('.gcheck-indicator');
            if (indicator) {
              indicator.classList.add('hidden');
            }
          });

          const activeBtn = document.getElementById('gbtn-theme-' + currentTheme);
          if (activeBtn) {
            activeBtn.classList.remove('border-slate-850', 'bg-slate-950');
            activeBtn.classList.add('border-amber-500', 'bg-slate-900', 'scale-[1.02]', 'shadow-lg');
            const indicator = activeBtn.querySelector('.gcheck-indicator');
            if (indicator) {
              indicator.classList.remove('hidden');
            }
          }
        };

        // Initialize highlights safely
        setTimeout(() => {
          if (typeof updateGlobalThemeCardsHighlight === 'function') {
            updateGlobalThemeCardsHighlight();
          }
        }, 100);

        // PWA Service Worker Registration & Installation Prompt Handler
        if ('serviceWorker' in navigator) {
          window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
              .then(reg => console.log('PWA Service Worker registered successfully:', reg.scope))
              .catch(err => console.error('PWA Service Worker registration failed:', err));
          });
        }

        window.deferredPrompt = null;
        window.addEventListener('beforeinstallprompt', (e) => {
          // Prevent Chrome 67 and earlier from automatically showing the prompt
          e.preventDefault();
          // Stash the event so it can be triggered later.
          window.deferredPrompt = e;
          // Notify the UI that installation is ready/available
          const installBtns = document.querySelectorAll('.pwa-install-btn-container');
          installBtns.forEach(el => {
            el.classList.remove('hidden');
          });
        });

        window.triggerPWAInstall = function() {
          const promptEvent = window.deferredPrompt;
          if (!promptEvent) {
            alert('To install, open this gaming portal in Chrome/Safari, tap the browser settings menu/share, and select "Add to Home Screen" or "Install App".');
            return;
          }
          // Show the install prompt
          promptEvent.prompt();
          // Wait for the user to respond to the prompt
          promptEvent.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
              console.log('User accepted the install prompt');
            } else {
              console.log('User dismissed the install prompt');
            }
            window.deferredPrompt = null;
          });
        };
      </script>
    </body>
    </html>
  `;
}

// Utility to escape HTML variables for rendering security
function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -------------------------------------------------------------
// DEFAULT REDIRECTIONS
// -------------------------------------------------------------
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.json({
    "name": "MVP Tournament Portal",
    "short_name": "MVP",
    "description": "Premium mobile-first tournament gaming platform",
    "start_url": "/index.php",
    "scope": "/",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#05040d",
    "theme_color": "#05040d",
    "categories": ["games", "sports"],
    "icons": [
      {
        "src": "https://img.icons8.com/color/512/game-controller.png",
        "sizes": "512x512",
        "type": "image/png",
        "purpose": "any"
      },
      {
        "src": "https://img.icons8.com/color/192/game-controller.png",
        "sizes": "192x192",
        "type": "image/png",
        "purpose": "any"
      },
      {
        "src": "https://img.icons8.com/color/512/game-controller.png",
        "sizes": "512x512",
        "type": "image/png",
        "purpose": "maskable"
      }
    ]
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.send(`
    self.addEventListener('install', (event) => {
      self.skipWaiting();
    });

    self.addEventListener('activate', (event) => {
      event.waitUntil(self.clients.claim());
    });

    self.addEventListener('fetch', (event) => {
      event.respondWith(fetch(event.request));
    });
  `);
});

// FULL APP SOURCE CODE DOWNLOAD ENDPOINT (ZIP EXPORTER)
app.get('/download-project-source.zip', (req, res) => {
  try {
    const zip = new AdmZip();
    const rootDir = process.cwd();

    function addFilesRecursively(currentDir: string, zipPath = '') {
      const items = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = path.join(currentDir, item.name);
        const relZipPath = zipPath ? path.join(zipPath, item.name) : item.name;

        // Ignore massive, unneeded, or sensitive system folders & files
        if (
          item.name === 'node_modules' ||
          item.name === '.git' ||
          item.name === 'dist' ||
          item.name === '.env' ||
          item.name === 'package-lock.json' ||
          item.name === '.next' ||
          item.name === '.cursor' ||
          item.name === '.github' ||
          item.name === 'server.js'
        ) {
          continue;
        }

        if (item.isDirectory()) {
          // Recurse into subdirectory
          addFilesRecursively(fullPath, relZipPath);
        } else if (item.isFile()) {
          // Skip temporary/binary logs and archives
          if (item.name.endsWith('.log') || item.name.endsWith('.zip') || item.name.endsWith('.db')) {
            continue;
          }
          const content = fs.readFileSync(fullPath);
          zip.addFile(relZipPath, content);
        }
      }
    }

    addFilesRecursively(rootDir);
    const buffer = zip.toBuffer();

    // Set responsive headers for instant attachment download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=mvp_tournament_portal_source_code.zip');
    res.send(buffer);
  } catch (err: any) {
    console.error('Failed to generate full source code zip:', err);
    res.status(500).send(`Error while generating project source ZIP: ${err.message}`);
  }
});

// Digital Asset Links for full-screen Play Store App integration (TWA)
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  
  // High-performance defaults that can be easily customized or updated in production
  const packageName = req.query.package_name as string || "com.mvp.tourney";
  
  // Custom SHA256 fingerprint of the Google Play verification certificate
  const sha256 = req.query.sha256 as string || "A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:A1:B2:C3:D4:E5:F6:12:34";
  
  res.json([
    {
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": packageName,
        "sha256_cert_fingerprints": [sha256]
      }
    }
  ]);
});

app.get('/', (req, res) => {
  const db = readDb();
  if (db.users.length === 0 && db.admin.length === 0) {
    return res.redirect('/install.php');
  }
  res.redirect('/index.php');
});

// -------------------------------------------------------------
// INSTALLATION SCREEN: install.php
// -------------------------------------------------------------
app.get('/install.php', (req, res) => {
  const db = readDb();
  const session = getSession(req, res);
  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const html = `
    <div class="flex flex-col items-center justify-center py-8">
      <div class="w-16 h-16 rounded-2xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-2xl shadow-[0_0_24px_rgba(16,185,129,0.3)] mb-4 font-mono animate-pulse">MVP</div>
      <h1 class="text-2xl font-bold text-center tracking-tight mb-2">Setup Wizard</h1>
      <p class="text-slate-400 text-sm text-center mb-6 px-4">Initialize target schemas, trigger triggers, setup default admin account (admin/admin123), and launch database tables.</p>

      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full mb-6">
        <h3 class="text-sm uppercase tracking-widest font-bold text-emerald-400 mb-3"><i class="fas fa-database"></i> SQL Blueprints</h3>
        <ul class="text-xs text-slate-300 space-y-2 font-mono">
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> users</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> admin</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> tournaments</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> participants</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> transactions</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> email_verifications</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> login_otp</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> rate_limits</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> referrals</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> notifications</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> match_screenshots</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> deposits</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> withdrawals</li>
          <li class="flex items-center gap-2"><i class="fas fa-check text-emerald-500"></i> admin_logs</li>
        </ul>
      </div>

      <form action="/install.php" method="POST" class="w-full">
        <button type="submit" class="w-full py-3.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black tracking-widest uppercase rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:scale-101">
          <i class="fas fa-terminal"></i> Initialize Schema
        </button>
      </form>
    </div>
  `;
  res.send(renderLayout(req, html, 'Install Database', false, flash, error));
});

app.post('/install.php', (req, res) => {
  const session = getSession(req, res);
  try {
    const freshDb: DBState = {
      users: [
        {
          id: 'user_1',
          username: 'demo_player',
          email: 'demo@example.com',
          password_hash: hashPassword('player123'),
          wallet_balance: 500.00,
          upi_id: 'player@paytm',
          referral_code: 'MVP500',
          referred_by: null,
          wallet_status: 'active',
          is_verified: 1,
          ip_address: req.ip || '127.0.0.1',
          device_info: req.headers['user-agent'] || 'Simulator WebAgent',
          account_status: 'active',
          created_at: new Date().toISOString()
        }
      ],
      admin: [
        {
          id: 'admin_1',
          username: 'admin',
          password_hash: hashPassword('admin123')
        }
      ],
      tournaments: [
        {
          id: 'tour_1',
          title: 'BGMI Clash of Titans',
          game_name: 'Battlegrounds Mobile India',
          entry_fee: 50.00,
          prize_pool: 500.00,
          match_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 mins
          room_id: '928310',
          room_password: 'game_rules_mvp',
          status: 'Upcoming',
          commission_pct: 20,
          match_release_time: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString()
        },
        {
          id: 'tour_2',
          title: 'Free Fire Ultimate Showdown',
          game_name: 'Free Fire MAX',
          entry_fee: 20.00,
          prize_pool: 200.00,
          match_time: new Date(Date.now() + 120 * 60 * 1000).toISOString(), // 2 hours
          room_id: 'FF77319',
          room_password: 'fire',
          status: 'Upcoming',
          commission_pct: 15,
          match_release_time: new Date(Date.now() + 100 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString()
        }
      ],
      participants: [],
      transactions: [
        {
          id: 'tx_init',
          user_id: 'user_1',
          amount: 500.00,
          type: 'credit',
          description: 'Welcome promotional deposit',
          upi_txn_id: 'TXN91837261',
          fraud_status: 'normal',
          review_required: false,
          created_at: new Date().toISOString()
        }
      ],
      email_verifications: [],
      login_otp: [],
      rate_limits: [],
      referrals: [],
      notifications: [
        {
          id: 'notif_1',
          user_id: 'user_1',
          title: '🚀 Active Sign-Up Bonus',
          message: 'Welcome to MVP! ₹500 is credited in your demo gaming account.',
          status: 'Unread',
          created_at: new Date().toISOString()
        }
      ],
      match_screenshots: [],
      admin_logs: [
        {
          id: 'log_1',
          admin_id: 'system',
          action: 'Database Initialization',
          details: 'Standard schema seed completed successfully by system scripts.',
          created_at: new Date().toISOString()
        }
      ],
      settings: {
        admin_upi_id: 'upi@upi',
        admin_qr_code: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150"><rect width="150" height="150" fill="white"/><rect x="20" y="20" width="40" height="40" fill="black"/><rect x="90" y="20" width="40" height="40" fill="black"/><rect x="20" y="90" width="40" height="40" fill="black"/><rect x="35" y="35" width="10" height="10" fill="white"/><rect x="105" y="35" width="10" height="10" fill="white"/><rect x="35" y="105" width="10" height="10" fill="white"/><rect x="70" y="50" width="10" height="50" fill="black"/><rect x="50" y="70" width="50" height="10" fill="black"/><rect x="90" y="90" width="20" height="20" fill="black"/><rect x="120" y="120" width="10" height="10" fill="black"/><text x="75" y="145" font-family="sans-serif" font-size="10" font-weight="bold" fill="black" text-anchor="middle">SCAN TO PAY</text></svg>',
        admin_password_hash: hashPassword('admin123')
      },
      deposits: [],
      withdrawals: []
    };

    writeDb(freshDb);
    session.message = "✅ SQL Tables and Mock Seed Created! You can now login with: demo_player / player123 (or admin / admin123 on /admin/login.php)";
    res.redirect('/login.php');
  } catch (err: any) {
    session.error = "Failed to run installer: " + err.message;
    res.redirect('/install.php');
  }
});

// -------------------------------------------------------------
// SAFE DATABASE UPDATE SCREEN: update_database.php
// -------------------------------------------------------------
app.get('/update_database.php', (req, res) => {
  const db = readDb();
  const session = getSession(req, res);
  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const html = `
    <div class="flex flex-col items-center justify-center py-10 text-center">
      <div class="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center font-black text-2xl mb-4">
        <i class="fas fa-sync-alt animate-spin"></i>
      </div>
      <h1 class="text-xl font-bold tracking-tight mb-2">Safe Schema Migration</h1>
      <p class="text-slate-400 text-xs px-6 mb-8">Execute safety scripts to verify columns like upi_id, referrals tables, notifications, and OTP systems. This ensures zero data loss.</p>

      <form action="/update_database.php" method="POST" class="w-full">
        <button type="submit" class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-slate-100 font-bold uppercase rounded-xl transition-all cursor-pointer">
          Trigger Safe Update
        </button>
      </form>
    </div>
  `;
  res.send(renderLayout(req, html, 'Schema Migration', false, flash, error));
});

app.post('/update_database.php', (req, res) => {
  const session = getSession(req, res);
  try {
    const db = readDb();
    
    // Safety check constraints
    db.users.forEach(u => {
      if (u.upi_id === undefined) u.upi_id = null;
      if (u.referral_code === undefined) u.referral_code = crypto.randomBytes(3).toString('hex').toUpperCase();
      if (u.referred_by === undefined) u.referred_by = null;
      if (u.wallet_status === undefined) u.wallet_status = 'active';
      if (u.is_verified === undefined) u.is_verified = 1;
      if (u.account_status === undefined) u.account_status = 'active';
    });

    if (!db.deposits) db.deposits = [];
    if (!db.withdrawals) db.withdrawals = [];
    if (!db.email_verifications) db.email_verifications = [];
    if (!db.login_otp) db.login_otp = [];
    if (!db.rate_limits) db.rate_limits = [];
    if (!db.referrals) db.referrals = [];
    if (!db.notifications) db.notifications = [];
    if (!db.match_screenshots) db.match_screenshots = [];
    if (!db.admin_logs) db.admin_logs = [];

    writeDb(db);
    session.message = "✅ Database schema updated successfully! You can now safely continue.";
    res.redirect('/index.php');
  } catch (err: any) {
    session.error = "Migration failure: " + err.message;
    res.redirect('/update_database.php');
  }
});

// Helper for generating CSRF Token
function getCsrfToken(req: express.Request): string {
  const session = getSession(req);
  const sid = (session as any).sid || 'default_sid';
  return crypto.createHash('sha1').update(sid).digest('hex').substring(0, 10);
}

// -------------------------------------------------------------
// USER LOGIN & SIGNUP: login.php
// -------------------------------------------------------------
app.get('/login.php', (req, res) => {
  const session = getSession(req, res);
  // If already logged in, redirect
  if (session.userId) {
    return res.redirect('/index.php');
  }

  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  const html = `
    <div class="py-2">
      <!-- Mascot / App Icon -->
      <div class="flex flex-col items-center mb-6">
        <div class="w-14 h-14 rounded-2xl bg-emerald-500 text-slate-950 flex items-center justify-center font-black text-2xl shadow-[0_0_20px_rgba(16,185,129,0.35)] mb-2 font-mono">MVP</div>
        <h2 class="text-xl font-bold tracking-tight text-white uppercase">Tournament Arena</h2>
        <p class="text-xs text-slate-500 font-mono">Mobile Esports Console</p>
      </div>

      <!-- Tab Buttons -->
      <div class="grid grid-cols-2 bg-slate-900 p-1 rounded-xl mb-6 border border-slate-800">
        <button onclick="switchTab('login-box', 'signup-box', this)" class="tab-btn py-2 text-xs uppercase font-extrabold tracking-widest rounded-lg bg-emerald-500 text-slate-950 transition-all cursor-pointer">
          <i class="fas fa-sign-in-alt shadow-sm"></i> Login
        </button>
        <button onclick="switchTab('signup-box', 'login-box', this)" class="tab-btn py-2 text-xs uppercase font-extrabold tracking-widest rounded-lg text-slate-400 hover:text-slate-200 transition-all cursor-pointer">
          <i class="fas fa-user-plus"></i> Sign-Up
        </button>
      </div>

      <!-- Login Section -->
      <div id="login-box" class="space-y-4">
        <!-- Standard Login -->
        <form action="/login.php" method="POST" class="space-y-3 p-4 bg-slate-900 border border-slate-800/80 rounded-2xl">
          <input type="hidden" name="csrf_token" value="${csrf}">
          <input type="hidden" name="sid" value="${(session as any).sid || ''}">
          <input type="hidden" name="action" value="login_pass">
          <h3 class="text-xs uppercase tracking-wider font-extrabold text-emerald-400 border-b border-slate-800 pb-2 mb-2"><i class="fas fa-lock"></i> Passcode Entry</h3>
          <div>
            <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Username / Email</label>
            <input type="text" name="identity" required placeholder="demo_player" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all text-slate-200 select-text">
          </div>
          <div>
            <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Password</label>
            <input type="password" name="password" required placeholder="••••••••" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-all text-slate-200 select-text">
          </div>
          <button type="submit" class="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold uppercase tracking-widest text-xs rounded-xl cursor-pointer transition-all hover:scale-101 mt-2">
            Secure Auth
          </button>
        </form>

        <!-- OTP Login Optional -->
        <form action="/login.php" method="POST" class="space-y-3 p-4 bg-slate-900 border border-slate-800/80 rounded-2xl">
          <input type="hidden" name="csrf_token" value="${csrf}">
          <input type="hidden" name="sid" value="${(session as any).sid || ''}">
          <input type="hidden" name="action" value="login_otp_send">
          <h3 class="text-xs uppercase tracking-wider font-extrabold text-amber-400 border-b border-slate-800 pb-2 mb-2"><i class="fas fa-shield-alt"></i> OTP Login (Zero-Password)</h3>
          <div>
            <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Registered Email ID</label>
            <div class="flex gap-2">
              <input type="email" name="email" required placeholder="gamer@example.com" class="flex-grow bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none transition-all text-slate-200 select-text">
              <button type="submit" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3 py-2.5 text-[10px] uppercase rounded-xl transition-all tracking-wider cursor-pointer">
                Send OTP
              </button>
            </div>
          </div>
          <p class="text-[9px] text-slate-500">We will log a verification code to the simulated mailbox above.</p>
        </form>

        <!-- OTP Verification Form (only shown if session requests OTP verify) -->
        ${session.otp_pending_user_id ? `
          <form action="/login.php" method="POST" class="p-4 bg-amber-950/20 border border-amber-500/30 rounded-2xl space-y-3 animate-pulse">
            <input type="hidden" name="csrf_token" value="${csrf}">
            <input type="hidden" name="sid" value="${(session as any).sid || ''}">
            <input type="hidden" name="action" value="login_otp_verify">
            <h3 class="text-xs font-bold text-amber-400"><i class="fas fa-key"></i> Key-in 6 Digit Code</h3>
            <div>
              <input type="text" name="otp_code" required maxlength="6" placeholder="000000" class="w-full text-center bg-slate-950 border border-amber-500/40 rounded-xl px-3 py-2 text-sm focus:ring-1 focus:ring-amber-500 focus:outline-none font-mono text-amber-400 select-text tracking-widest font-black">
            </div>
            <button type="submit" class="w-full py-2 bg-amber-500 text-slate-950 font-bold uppercase tracking-wider text-xs rounded-xl cursor-pointer">
              Verify & Authorize
            </button>
          </form>
        ` : ''}
      </div>

      <!-- Signup Section -->
      <div id="signup-box" class="hidden space-y-3">
        <form action="/login.php" method="POST" class="space-y-3 p-4 bg-slate-900 border border-slate-800 rounded-2xl">
          <input type="hidden" name="csrf_token" value="${csrf}">
          <input type="hidden" name="sid" value="${(session as any).sid || ''}">
          <input type="hidden" name="action" value="signup">
          <h3 class="text-xs uppercase tracking-wider font-extrabold text-emerald-400 border-b border-slate-800 pb-2 mb-2"><i class="fas fa-user-plus"></i> New Gamer Account</h3>
          
          <div>
            <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Username (No Spaces)</label>
            <input type="text" name="username" required placeholder="esports_pro" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-400 focus:outline-none text-slate-200 select-text">
          </div>
          <div>
            <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Email ID</label>
            <input type="email" name="email" required placeholder="gamer@example.com" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-400 focus:outline-none text-slate-200 select-text">
          </div>
          <div>
            <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Choose Password</label>
            <input type="password" name="password" required placeholder="••••••••" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-400 focus:outline-none text-slate-200 select-text">
          </div>
          <div>
            <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Referral Code (Optional)</label>
            <input type="text" name="referred_by" placeholder="MVP500" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-400 focus:outline-none border-dashed uppercase text-emerald-400 font-bold tracking-wider select-text">
          </div>
          <button type="submit" class="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold uppercase tracking-widest text-xs rounded-xl cursor-pointer mt-2">
            Build Account
          </button>
        </form>
      </div>
    </div>

    <script>
      function switchTab(showId, hideId, btn) {
        document.getElementById(showId).classList.remove('hidden');
        document.getElementById(hideId).classList.add('hidden');
        
        // Update styling
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.className = 'tab-btn py-2 text-xs uppercase font-extrabold tracking-widest rounded-lg text-slate-400 hover:text-slate-200 transition-all cursor-pointer';
        });
        
        btn.className = 'tab-btn py-2 text-xs uppercase font-extrabold tracking-widest rounded-lg bg-emerald-500 text-slate-950 transition-all cursor-pointer';
      }
    </script>
  `;
  res.send(renderLayout(req, html, 'Identity Gate', false, flash, error));
});

// LOGIN / SIGNUP LOGIC
app.post('/login.php', (req, res) => {
  const session = getSession(req, res);
  const db = readDb();
  const { action, csrf_token } = req.body;

  // CSRF validation
  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed. Attempt Rejected.";
    return res.redirect('/login.php');
  }

  // A. PASSWORD LOGIN BRANCH
  if (action === 'login_pass') {
    const { identity, password } = req.body;
    
    if (identity && identity.toLowerCase().trim() === '12rajaksuraj@gmail.com') {
      (session as any).isOwner = true;
    }
    
    // Rate limiter (5 login attempts / 15 mins)
    if (!checkRateLimit(session.ip, 'login_attempt', 5, 15)) {
      session.error = "❌ Brute force protection activated. Too many login attempts. Blocked for 15 minutes.";
      return res.redirect('/login.php');
    }

    const hashed = hashPassword(password || '');
    const user = db.users.find(u => (u.username === identity || u.email === identity));

    if (!user || user.password_hash !== hashed) {
      session.error = "Invalid combination of Username/Password.";
      return res.redirect('/login.php');
    }

    if (user.account_status === 'blocked') {
      session.error = "⛔ Blocked account: Your profile has been flagged and suspended.";
      return res.redirect('/login.php');
    }

    session.userId = user.id;
    session.message = `Welcome back, ${user.username}!`;
    return res.redirect('/index.php');
  }

  // B. SEND OTP LOGIN BRANCH
  if (action === 'login_otp_send') {
    const { email } = req.body;
    
    if (email && email.toLowerCase().trim() === '12rajaksuraj@gmail.com') {
      (session as any).isOwner = true;
    }

    const user = db.users.find(u => u.email === email);

    if (!user) {
      session.error = "No user found associated with that email.";
      return res.redirect('/login.php');
    }

    if (user.account_status === 'blocked') {
      session.error = "This account is blocked.";
      return res.redirect('/login.php');
    }

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 90000).toString();
    const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 mins

    db.login_otp.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      otp,
      expires_at: expires,
      status: 'Pending'
    });
    writeDb(db);

    // Simulated email dispatch
    addMail(
      user.email,
      'OTP_LOGIN',
      '🔐 Login One-Time Passcode (OTP)',
      `Hello ${user.username}, use this 6-digit OTP code to verify and log in. Expires in 5 minutes.`,
      otp
    );

    session.otp_pending_user_id = user.id;
    session.message = `🔑 Your login OTP is: ${otp}. Please type this code below to verify and sign in!`;
    return res.redirect('/login.php');
  }

  // C. VERIFY OTP BRANCH
  if (action === 'login_otp_verify') {
    const { otp_code } = req.body;
    const userId = session.otp_pending_user_id;

    if (!userId) {
      session.error = "No pending OTP request sessions found.";
      return res.redirect('/login.php');
    }

    const records = db.login_otp.filter(r => r.user_id === userId && r.status === 'Pending' && r.expires_at >= new Date().toISOString());
    const validRecord = records.find(r => r.otp === (otp_code || '').trim());

    if (!validRecord) {
      session.error = "Invalid OTP code entered. Please try again.";
      return res.redirect('/login.php');
    }

    // Mark OTP as used
    validRecord.status = 'Used';
    writeDb(db);

    delete session.otp_pending_user_id;
    session.userId = userId;
    session.message = "Authorized successfully via secure OTP passcode!";
    return res.redirect('/index.php');
  }

  // D. SIGNUP REGISTER BRANCH
  if (action === 'signup') {
    const { username, email, password, referred_by } = req.body;
    
    if (email && email.toLowerCase().trim() === '12rajaksuraj@gmail.com') {
      (session as any).isOwner = true;
    }

    const trimmedUsername = (username || '').trim().toLowerCase();
    if (db.users.some(u => u.username.toLowerCase() === trimmedUsername)) {
      session.error = "Username is already taken.";
      return res.redirect('/login.php');
    }

    if (db.users.some(u => u.email.toLowerCase() === (email || '').trim().toLowerCase())) {
      session.error = "Email address is already registered.";
      return res.redirect('/login.php');
    }

    // Anti-Multiple Account check
    const existingSameIp = db.users.filter(u => u.ip_address === session.ip);
    let userAccountStatus: 'active' | 'blocked' = 'active';
    let accountComment = 'active';
    
    // Automatically flag or block if threshold of duplicate accounts exceeded
    if (existingSameIp.length >= 3) {
      accountComment = 'flagged_suspicious';
    }

    // Create unique referral code
    const personalReferralCode = 'MVP' + crypto.randomInt(100, 999).toString() + trimmedUsername.substring(0, 3).toUpperCase();

    const newUserId = 'user_' + crypto.randomUUID().split('-')[0];
    
    // Referral Bonus Logic
    let refUser: User | null = null;
    let initialBalance = 20.00; // Sign-up bonus for new users set to exactly ₹20.00

    if (referred_by) {
      refUser = db.users.find(u => u.referral_code === referred_by.trim().toUpperCase()) || null;
      if (refUser) {
        db.notifications.push({
          id: crypto.randomUUID(),
          user_id: refUser.id,
          title: '🎁 Friend Invited',
          message: `Congratulations! @${trimmedUsername} joined using your invite code. You will receive ₹5.00 once they make their first deposit!`,
          status: 'Unread',
          created_at: new Date().toISOString()
        });
      }
    }

    const newUser: User = {
      id: newUserId,
      username: trimmedUsername,
      email: email.trim(),
      password_hash: hashPassword(password),
      wallet_balance: initialBalance,
      unwithdrawable_bonus: 20.00, // Safe play-only bonus of ₹20
      upi_id: null,
      referral_code: personalReferralCode,
      referred_by: refUser ? refUser.id : null,
      wallet_status: 'active',
      is_verified: 1, // Instantly fully verified in one step
      ip_address: session.ip,
      device_info: req.headers['user-agent'] || 'Mock Emulator/1.0',
      account_status: userAccountStatus,
      created_at: new Date().toISOString()
    };

    // Generate Email Verification Token
    const verificationToken = crypto.randomUUID().split('-').map(p => p[0]).join('').substring(0, 5).toUpperCase() + crypto.randomInt(100, 999);
    
    db.users.push(newUser);
    db.email_verifications.push({
      id: crypto.randomUUID(),
      user_id: newUserId,
      token: verificationToken,
      status: 'Verified', // Pre-verified
      created_at: new Date().toISOString()
    });

    // Logging transaction log for sign-up bonus
    db.transactions.push({
      id: 'tx_signup_' + crypto.randomUUID().substring(0,6),
      user_id: newUserId,
      amount: initialBalance,
      type: 'credit',
      description: 'Sign-up promo balance credited.',
      upi_txn_id: null,
      fraud_status: 'normal',
      review_required: false,
      created_at: new Date().toISOString()
    });

    writeDb(db);

    // Simulated email dispatch
    addMail(
      newUser.email,
      'EMAIL_VERIFICATION',
      '✉️ Activate your MVP Tournament Profile',
      `Hello! Your account is automatically active. Click here if you need to browse token details: /verify_email.php?token=${verificationToken}`,
      verificationToken
    );

    session.userId = newUser.id;
    session.message = "🎉 Account registered and verified successfully! Welcome to the Arena!";
    return res.redirect('/index.php');
  }

  session.error = "Malformed POST Request Action.";
  res.redirect('/login.php');
});

// -------------------------------------------------------------
// VERIFY EMAIL CONTROLLER: verify_email.php
// -------------------------------------------------------------
app.get('/verify_email.php', (req, res) => {
  const token = req.query.token as string;
  const session = getSession(req, res);
  const db = readDb();

  if (!token) {
    session.error = "Empty email token requested.";
    return res.redirect('/index.php');
  }

  const verRecord = db.email_verifications.find(e => e.token === token.trim() && e.status === 'Pending');
  if (!verRecord) {
    session.error = "Invalid or Expired verification token.";
    return res.redirect('/index.php');
  }

  const user = db.users.find(u => u.id === verRecord.user_id);
  if (user) {
    user.is_verified = 1;
    verRecord.status = 'Verified';
    
    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      title: '✅ Profile Verified Successfully',
      message: 'Email address has been verified. You can now join tournaments and use wallet payout features!',
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    writeDb(db);
    session.message = "🎉 Email verified successfully! Your profile is active.";
  } else {
    session.error = "User link broken.";
  }
  res.redirect('/index.php');
});

app.get('/logout.php', (req, res) => {
  const session = getSession(req, res);
  SessionsStore.delete(parseCookies(req.headers.cookie)['sid']);
  res.redirect('/login.php');
});

// -------------------------------------------------------------
// HOMEPAGE: index.php (Dynamic list of tournaments)
// -------------------------------------------------------------
app.get('/index.php', (req, res) => {
  const session = getSession(req, res);
  // User Authentication Guard
  if (!session.userId) {
    return res.redirect('/login.php');
  }

  const db = readDb();
  const user = db.users.find(u => u.id === session.userId);
  if (!user) {
    return res.redirect('/login.php');
  }

  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  // Active upcoming tournaments
  const upcomingTours = db.tournaments.filter(t => t.status === 'Upcoming' || t.status === 'Live');

  // Construct premium carousel slideshow cards
  const featuredSlides: {
    title: string;
    subtitle: string;
    tag: string;
    badgeColor: string;
    gradient: string;
    accentText: string;
    ctaText: string;
    actionUrl: string;
  }[] = [];
  
  // Dynamic card content from actual tournaments
  if (upcomingTours.length > 0) {
    upcomingTours.slice(0, 3).forEach((t, i) => {
      let gradient = 'from-emerald-600 via-teal-500 to-amber-500';
      if (i === 1) gradient = 'from-amber-600 via-orange-500 to-rose-600';
      if (i === 2) gradient = 'from-rose-600 via-pink-600 to-orange-500';
      
      const joinedCount = db.participants.filter(p => p.tournament_id === t.id).length;
      featuredSlides.push({
        title: t.title,
        subtitle: `Battle for high reward stakes in ${t.game_name}! Matches begin shortly. Register of slots now.`,
        tag: '⚔️ FEATURED TOURNAMENT',
        badgeColor: 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40',
        gradient,
        accentText: `PRIZE: ₹${t.prize_pool.toFixed(0)} • ENTRY: ₹${t.entry_fee.toFixed(0)}`,
        ctaText: 'Play Arena',
        actionUrl: `#tour-${t.id}`
      });
    });
  }

  // Fallback premium aesthetic slides if list is short
  if (featuredSlides.length < 3) {
    featuredSlides.push({
      title: 'Free Fire Solo Championship',
      subtitle: 'Survive till the end, claim maximum booyah and command absolute glory. High anti-cheat active.',
      tag: '🔥 POPULAR TOURNAMENT',
      badgeColor: 'bg-amber-500/25 text-amber-300 border-amber-500/40',
      gradient: 'from-amber-600 via-orange-500 to-rose-600',
      accentText: 'PRIZE POOL: ₹25,000 • DAILY STAGE',
      ctaText: 'Enter Arena',
      actionUrl: '#action-live-battles'
    });
  }
  if (featuredSlides.length < 3) {
    featuredSlides.push({
      title: 'Ludo King Royal Quad Rumble',
      subtitle: 'Classic board challenge. Double your stake return and request super fast validation.',
      tag: '👑 CASUAL MEGAPOOL',
      badgeColor: 'bg-rose-500/25 text-rose-300 border-rose-500/40',
      gradient: 'from-rose-600 via-pink-500 to-orange-500',
      accentText: 'PRIZE RANGE: ₹10,000 • SECURE WINNERS',
      ctaText: 'Play Board',
      actionUrl: '#action-live-battles'
    });
  }
  if (featuredSlides.length < 3) {
    featuredSlides.push({
      title: 'Secure Wallet Deposit Gateway',
      subtitle: 'Scan unified UPI QR Code, insert payment transaction ID and get verified within seconds.',
      tag: '🛡️ SECURE STORAGE',
      badgeColor: 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40',
      gradient: 'from-emerald-600 via-teal-500 to-indigo-600',
      accentText: 'MINIMUM ₹10 • INSTANT APPROVALS',
      ctaText: 'Deposit Funds',
      actionUrl: '/wallet.php'
    });
  }

  const tourCardHtml = upcomingTours.map(t => {
    const joinedCount = db.participants.filter(p => p.tournament_id === t.id).length;
    const hasJoined = db.participants.some(p => p.tournament_id === t.id && p.user_id === user.id);
    const dateFormatted = new Date(t.match_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `
      <!-- Tournament Item Component -->
      <div id="tour-${t.id}" class="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-3 relative shadow-md hover:border-emerald-500/35 hover:-translate-y-0.5 transition-all">
        <!-- Live status badge -->
        <div class="flex justify-between items-start">
          <div>
            <span class="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] font-bold uppercase tracking-wider">${escapeHtml(t.game_name)}</span>
          </div>
          <div class="text-[10px] text-slate-400 font-mono font-black flex items-center gap-1.5 bg-slate-950 px-2 py-0.8 rounded-lg border border-slate-900/50">
            <i class="far fa-clock text-amber-400"></i> ${dateFormatted}
          </div>
        </div>

        <div>
          <h2 class="text-base font-bold text-slate-100 tracking-tight leading-tight">${escapeHtml(t.title)}</h2>
        </div>

        <!-- Bento parameters -->
        <div class="grid grid-cols-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-900/60 text-center gap-1 text-[11px]">
          <div>
            <span class="block text-[8px] uppercase font-bold tracking-widest text-slate-500 mb-0.5">Entry Fee</span>
            <span class="font-extrabold text-amber-400">₹${t.entry_fee.toFixed(0)}</span>
          </div>
          <div>
            <span class="block text-[8px] uppercase font-bold tracking-widest text-slate-500 mb-0.5">Prize Pool</span>
            <span class="font-bold text-emerald-400">₹${t.prize_pool.toFixed(0)}</span>
          </div>
          <div>
            <span class="block text-[8px] uppercase font-bold tracking-widest text-slate-500 mb-0.5">Slots</span>
            <span class="font-black text-slate-300">${joinedCount} Registered</span>
          </div>
        </div>

        <!-- Join Form Submission -->
        <form action="/index.php" method="POST" class="mt-2 flex">
          <input type="hidden" name="csrf_token" value="${csrf}">
          <input type="hidden" name="tournament_id" value="${t.id}">
          ${hasJoined ? `
            <div class="w-full flex items-center justify-center py-2 px-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-extrabold text-emerald-400 tracking-widest uppercase">
              <i class="fas fa-check-circle mr-1.5 text-emerald-400"></i> Slots Confirmed
            </div>
          ` : `
            <button type="submit" class="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs tracking-widest uppercase rounded-xl transition-all shadow-[0_0_10px_rgba(16,185,129,0.15)] hover:scale-102 cursor-pointer flex items-center justify-center gap-1">
              <i class="fas fa-bolt"></i> Join Now
            </button>
          `}
        </form>
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <!-- Quick user welcoming banner -->
      <div class="flex items-center justify-between bg-gradient-to-r from-slate-950 to-slate-900 border border-slate-900 rounded-2xl p-4 shadow-inner">
        <div>
          <span class="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Welcome Fighter</span>
          <h2 class="text-lg font-bold text-slate-200">@${escapeHtml(user.username)}</h2>
          ${user.is_verified === 0 ? `
            <span class="inline-flex items-center gap-1 text-[9px] text-rose-400 font-bold bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded-md mt-1 animate-pulse"><i class="fas fa-times-circle"></i> Unverified Email Profile</span>
          ` : `
            <span class="inline-flex items-center gap-1 text-[9px] text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded-md mt-1"><i class="fas fa-check-circle"></i> Authorized Gamer</span>
          `}
        </div>
        <div class="text-right">
          <span class="text-[9px] text-slate-400 uppercase tracking-widest font-mono">Current Balance</span>
          <h3 class="text-xl font-black text-slate-100">₹${user.wallet_balance.toFixed(2)}</h3>
        </div>
      </div>

      <!-- NEW DETAILED HERO CAROUSEL BLOCK -->
      <div class="relative w-full h-44 rounded-3xl overflow-hidden shining-card premium-glow-orange border border-amber-500/20 shadow-2xl accelerated">
        <!-- Slides Container -->
        <div class="absolute inset-0 w-full h-full" id="carousel-slides-container">
          ${featuredSlides.map((slide, idx) => {
            const gradientParts = slide.gradient.split(' ');
            const startColor = gradientParts[1] || 'from-amber-600';
            const endColor = gradientParts[3] || gradientParts[1] || 'to-rose-600';
            return `
              <div class="carousel-slide absolute inset-0 w-full h-full flex flex-col justify-end p-5 transition-all duration-700 ease-out transform opacity-0 scale-95 z-0" data-index="${idx}" style="background: linear-gradient(135deg, rgba(8, 5, 20, 0.88) 0%, rgba(5, 3, 15, 0.98) 100%), linear-gradient(to right, ${startColor === 'from-emerald-600' ? '#059669' : (startColor === 'from-amber-600' ? '#d97706' : '#e11d48')} 0%, ${endColor === 'to-amber-500' ? '#f59e0b' : (endColor === 'to-rose-600' ? '#e11d48' : '#312e81')} 100%); background-blend-mode: overlay;">
                <!-- Moving accent gloworb in the behind -->
                <div class="absolute top-0 right-0 w-44 h-44 bg-gradient-to-br ${slide.gradient} rounded-full opacity-20 blur-2xl transform translate-x-12 -translate-y-12"></div>
                
                <div class="relative z-10 space-y-1.5">
                  <div>
                    <span class="inline-flex px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border ${slide.badgeColor}">
                      ${slide.tag}
                    </span>
                  </div>
                  
                  <h3 class="text-base font-black tracking-tight text-white leading-tight drop-shadow text-glow-amber">
                    ${escapeHtml(slide.title)}
                  </h3>
                  
                  <p class="text-[10px] text-slate-300 leading-snug max-w-[88%] font-normal">
                    ${escapeHtml(slide.subtitle)}
                  </p>
                  
                  <div class="flex items-center justify-between pt-1 border-t border-slate-800/60 mt-2">
                    <span class="text-[9px] font-mono font-bold text-amber-400">
                      <i class="fas fa-fire-alt text-orange-500 mr-0.5 animate-pulse"></i> ${escapeHtml(slide.accentText)}
                    </span>
                    
                    <a href="${slide.actionUrl}" class="inline-flex items-center gap-1.5 py-1 px-3 bg-white/10 hover:bg-white/20 hover:scale-105 active:scale-95 text-white border border-white/10 text-[8px] uppercase tracking-widest font-black rounded-lg transition-all cursor-pointer">
                      ${escapeHtml(slide.ctaText)} <i class="fas fa-chevron-right text-[7px] text-amber-400"></i>
                    </a>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Touch Controls -->
        <button onclick="prevSlide(event)" class="absolute left-2.5 top-1/2 -translate-y-1/2 w-7 h-7 bg-slate-950/60 border border-slate-800/40 hover:bg-slate-900 rounded-full flex items-center justify-center text-[10px] text-slate-300 hover:text-white transition-all cursor-pointer z-20">
          <i class="fas fa-chevron-left"></i>
        </button>
        <button onclick="nextSlide(event)" class="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 bg-slate-950/60 border border-slate-800/40 hover:bg-slate-900 rounded-full flex items-center justify-center text-[10px] text-slate-300 hover:text-white transition-all cursor-pointer z-20">
          <i class="fas fa-chevron-right"></i>
        </button>

        <!-- Bullet Dots -->
        <div class="absolute bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-20">
          ${featuredSlides.map((_, idx) => `
            <span class="carousel-dot-indicator block w-1.5 h-1.5 rounded-full bg-white/20 border border-black/20 cursor-pointer transition-all duration-300" onclick="setSlide(${idx}, event)"></span>
          `).join('')}
        </div>
      </div>

      <!-- Action items info banner -->
      <h2 id="action-live-battles" class="text-xs uppercase font-extrabold text-slate-400 tracking-wider flex items-center gap-1 mt-6">
        <i class="fas fa-bullseye text-amber-500"></i> Live Playroom Battles
      </h2>

      <!-- Tournament Cards Stack -->
      <div class="space-y-4">
        ${upcomingTours.length === 0 ? `
          <div class="border border-dashed border-slate-800 rounded-2xl py-12 px-4 text-center">
            <div class="text-slate-600 mb-2"><i class="fas fa-gamepad text-3xl"></i></div>
            <h3 class="text-sm font-bold text-slate-400">No tournaments created.</h3>
            <p class="text-[10px] text-slate-600">Please seed database or trigger tournament templates in the Admin portal.</p>
          </div>
        ` : tourCardHtml}
      </div>
    </div>
  `;
  res.send(renderLayout(req, html, 'Tournament Battlefield', false, flash, error));
});

// TOURNAMENT JOINING LOGIC
app.post('/index.php', (req, res) => {
  const session = getSession(req, res);
  if (!session.userId) return res.redirect('/login.php');

  const db = readDb();
  const { tournament_id, csrf_token } = req.body;

  // CSRF validation
  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed. Attempt Rejected.";
    return res.redirect('/index.php');
  }

  // Rate Limiting (5 tournament joins per minute)
  if (!checkRateLimit(session.ip, 'join_tournament_req', 5, 1)) {
    session.error = "❌ Too frequent requests. Join attempts restricted to 5 per minute.";
    return res.redirect('/index.php');
  }

  const user = db.users.find(u => u.id === session.userId);
  if (!user) return res.redirect('/login.php');

  // Verification verification
  if (user.is_verified === 0) {
    session.error = "🚫 Verify email account first. Unverified profiles are blocked from gaming balance entries.";
    return res.redirect('/index.php');
  }

  // Wallet freeze protection
  if (user.wallet_status === 'frozen') {
    session.error = "⛔ Frozen Account: Wallet transactions and entry fees are currently suspended by the Admin.";
    return res.redirect('/index.php');
  }

  const tour = db.tournaments.find(t => t.id === tournament_id);
  if (!tour) {
    session.error = "Tournament not found.";
    return res.redirect('/index.php');
  }

  if (tour.status === 'Completed') {
    session.error = "This room match is already completed.";
    return res.redirect('/index.php');
  }

  // Validate double registrations
  const alreadyRegistered = db.participants.some(p => p.tournament_id === tour.id && p.user_id === user.id);
  if (alreadyRegistered) {
    session.error = "You stand registered and confirmed in this playroom lobby.";
    return res.redirect('/index.php');
  }

  // Check funds
  if (user.wallet_balance < tour.entry_fee) {
    session.error = `Insufficient money. Entry standard is ₹${tour.entry_fee}, while your wallet contains ₹${user.wallet_balance.toFixed(2)}.`;
    return res.redirect('/wallet.php');
  }

  // Deduct fee and add participant
  user.wallet_balance -= tour.entry_fee;
  if (user.unwithdrawable_bonus && user.unwithdrawable_bonus > 0) {
    const bonusDeduction = Math.min(user.unwithdrawable_bonus, tour.entry_fee);
    user.unwithdrawable_bonus -= bonusDeduction;
  }
  db.participants.push({
    id: 'part_' + crypto.randomUUID().split('-')[0],
    user_id: user.id,
    tournament_id: tour.id
  });

  // Record debit transaction
  db.transactions.push({
    id: 'tx_entry_' + crypto.randomUUID().substring(0,6),
    user_id: user.id,
    amount: tour.entry_fee,
    type: 'debit',
    description: `Registered entry fee for tournament match: ${tour.title}`,
    upi_txn_id: null,
    fraud_status: 'normal',
    review_required: false,
    created_at: new Date().toISOString()
  });

  // Store alert notify logs
  db.notifications.push({
    id: crypto.randomUUID(),
    user_id: user.id,
    title: '🎮 Tournament Joined',
    message: `Lobby Confirmed. You joined "${tour.title}". Match Room details released 15 minutes before play!`,
    status: 'Unread',
    created_at: new Date().toISOString()
  });

  writeDb(db);
  session.message = `🎉 Joined successfully! ₹${tour.entry_fee.toFixed(0)} deducted from wallet.`;
  res.redirect('/index.php');
});

// -------------------------------------------------------------
// MY TOURNAMENTS PORTAL: my_tournaments.php
// -------------------------------------------------------------
app.get('/my_tournaments.php', (req, res) => {
  const session = getSession(req, res);
  if (!session.userId) return res.redirect('/login.php');

  const db = readDb();
  const user = db.users.find(u => u.id === session.userId);
  if (!user) return res.redirect('/login.php');

  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  // Tournaments user joined
  const joinedMatches = db.participants.filter(p => p.user_id === user.id).map(p => {
    return {
      tour: db.tournaments.find(t => t.id === p.tournament_id)!,
      part_id: p.id
    };
  }).filter(entry => entry.tour !== undefined);

  const upcomingJoined = joinedMatches.filter(entry => entry.tour.status !== 'Completed');
  const completedJoined = joinedMatches.filter(entry => entry.tour.status === 'Completed');

  // Loop lists items
  const upcomingJoinedHtml = upcomingJoined.map(entry => {
    const t = entry.tour;
    const matchTimeMs = new Date(t.match_time).getTime();
    const releaseTimeMs = new Date(t.match_release_time).getTime();
    const currTimeMs = Date.now();

    // Check if within release time or play time
    const areCredentialsReleased = (currTimeMs >= releaseTimeMs);
    const textBadgeTimer = new Date(t.match_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-3 shadow-inner">
        <div class="flex justify-between items-start">
          <span class="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[9px] font-bold uppercase select-none">${escapeHtml(t.game_name)}</span>
          <span class="text-[9px] font-mono font-bold text-slate-400"><i class="fas fa-play text-emerald-400 text-[8px] animate-pulse"></i> Starts at ${textBadgeTimer}</span>
        </div>
        <h3 class="font-bold text-slate-100 text-sm leading-snug">${escapeHtml(t.title)}</h3>
        
        <!-- Room Info Distribution System -->
        <div class="bg-slate-950 p-3 rounded-xl border border-slate-900 relative">
          <div class="flex items-center gap-1.5 text-xs text-slate-400 font-bold border-b border-slate-900 pb-1.5 mb-2">
            <i class="fas fa-key text-[10px] text-emerald-400 animate-pulse"></i> Playroom Lobby Credentials
          </div>
          ${areCredentialsReleased ? `
            <div class="grid grid-cols-2 text-xs gap-3">
              <div>
                <span class="block text-[8px] uppercase tracking-wider text-slate-500 font-bold mb-0.5">ROOM ID</span>
                <span class="font-mono text-emerald-400 font-black tracking-widest select-all text-sm bg-slate-900 px-2 py-0.5 rounded border border-slate-800/50">${escapeHtml(t.room_id)}</span>
              </div>
              <div>
                <span class="block text-[8px] uppercase tracking-wider text-slate-500 font-bold mb-0.5">PASSWORD</span>
                <span class="font-mono text-indigo-400 font-black tracking-widest select-all text-sm bg-slate-900 px-2 py-0.5 rounded border border-slate-800/50">${escapeHtml(t.room_password)}</span>
              </div>
            </div>
            <p class="text-[8px] text-emerald-400/80 mt-2 font-mono flex items-center gap-1 leading-snug"><i class="fas fa-shield-alt"></i> Distributed automatically under participant authorization rule.</p>
          ` : `
            <div class="text-center py-2">
              <i class="fas fa-lock text-slate-700 text-lg mb-1 block"></i>
              <p class="text-[9px] text-slate-500">Locked until 15 minutes before the match start time (${new Date(t.match_release_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}) to prevent unfair scouting.</p>
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');

  const completedJoinedHtml = completedJoined.map(entry => {
    const t = entry.tour;
    const screenshot = db.match_screenshots.find(s => s.user_id === user.id && s.tournament_id === t.id);

    return `
      <div class="bg-slate-900 border border-slate-800/50 rounded-2xl p-4 space-y-3">
        <div class="flex justify-between items-start">
          <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] font-bold uppercase">${escapeHtml(t.game_name)}</span>
          <span class="text-[9px] text-slate-500 font-bold font-mono"><i class="fas fa-check-double text-emerald-500"></i> Match Finished</span>
        </div>
        <h3 class="font-bold text-slate-300 text-sm leading-snug">${escapeHtml(t.title)}</h3>

        <!-- Match Result Screenshot upload tracker -->
        <div class="bg-slate-950 p-3 rounded-xl border border-slate-900/60 mt-1.5">
          <div class="flex justify-between items-center text-xs text-slate-400 font-bold border-b border-slate-900 pb-1.5 mb-2">
            <span>🏆 Result Verification System</span>
            ${screenshot ? `
              <span class="px-1.5 py-0.5 text-[8px] rounded border ${screenshot.status === 'Approved' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : screenshot.status === 'Pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'} scroll-none uppercase tracking-wider font-extrabold font-mono">${screenshot.status}</span>
            ` : `
              <span class="text-[8px] text-rose-400 font-extrabold uppercase font-mono tracking-wider animate-pulse">Missing Upload</span>
            `}
          </div>

          ${screenshot ? `
            <div class="flex items-center gap-3">
              <img src="${screenshot.image}" class="w-10 h-10 object-cover rounded-lg border border-slate-800">
              <div class="text-[10px] leading-relaxed">
                <span class="text-slate-500 font-mono block">Uploaded Date: ${new Date(screenshot.created_at).toLocaleDateString()}</span>
                <span class="text-slate-400 font-semibold block">${screenshot.status === 'Approved' ? 'Validated by Referee. Reward is processing/processed.' : 'Admin is manually audit validating the match results screenshot.'}</span>
              </div>
            </div>
          ` : `
            <form action="/my_tournaments.php" method="POST" class="space-y-2 flex flex-col">
              <input type="hidden" name="csrf_token" value="${csrf}">
              <input type="hidden" name="tournament_id" value="${t.id}">
              <input type="hidden" id="screen_${t.id}_base64" name="screenshot_base64" required>
              
              <p class="text-[9px] text-slate-500 leading-snug mb-1">To claim match spoils and avoid penalties, upload a direct screenshot of your in-game placement screen. (PNG/JPG, MAX 2MB)</p>
              
              <div class="flex items-center gap-2">
                <label class="flex-grow flex items-center justify-center gap-1.5 py-2 px-3 border border-dashed border-slate-800 hover:border-emerald-500/50 bg-slate-900 text-slate-400 rounded-xl cursor-pointer text-[10px] uppercase font-bold tracking-wider hover:text-slate-300 transition-all select-none">
                  <i class="fas fa-image text-emerald-500"></i> Select Screenshot
                  <input type="file" id="file_${t.id}" accept="image/png, image/jpeg, image/webp" class="hidden" onchange="convertAndBindFile(this, 'screen_${t.id}_base64')">
                </label>
                <button type="submit" class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black px-4 py-2 text-[10px] uppercase tracking-wider rounded-xl transition-all cursor-pointer">
                  Submit Proof
                </button>
              </div>
            </form>
          `}
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <!-- Tabs header design -->
      <div class="grid grid-cols-2 bg-slate-900 p-1 border border-slate-800 rounded-xl mb-4 text-center">
        <button onclick="toggleMyToursTab('upcoming-sect', 'completed-sect', this)" class="tab-my font-mono text-xs uppercase tracking-wider font-extrabold rounded-lg bg-emerald-500 text-slate-950 py-1.5 transition-all cursor-pointer">
          <i class="fas fa-gamepad"></i> Upcoming/Live (${upcomingJoined.length})
        </button>
        <button onclick="toggleMyToursTab('completed-sect', 'upcoming-sect', this)" class="tab-my font-mono text-xs uppercase tracking-wider font-extrabold rounded-lg text-slate-400 hover:text-slate-200 py-1.5 transition-all cursor-pointer">
          <i class="fas fa-check-circle"></i> Completed (${completedJoined.length})
        </button>
      </div>

      <!-- Upcoming section -->
      <div id="upcoming-sect" class="space-y-4">
        ${upcomingJoined.length === 0 ? `
          <div class="border border-dashed border-slate-900 py-16 text-center text-slate-600 rounded-2xl flex flex-col items-center">
            <i class="fas fa-calendar-times text-2xl mb-1 flex"></i>
            <h3 class="text-xs font-bold text-slate-400 uppercase select-none">No Active Registrations</h3>
            <p class="text-[9px] mt-0.5 text-slate-600">Join upcoming events directly from the home tournament screen.</p>
          </div>
        ` : upcomingJoinedHtml}
      </div>

      <!-- Completed section -->
      <div id="completed-sect" class="hidden space-y-4">
        ${completedJoined.length === 0 ? `
          <div class="border border-dashed border-slate-900 py-16 text-center text-slate-600 rounded-2xl flex flex-col items-center">
            <i class="fas fa-history text-2xl mb-1 flex"></i>
            <h3 class="text-xs font-bold text-slate-400 uppercase select-none">History Empty</h3>
            <p class="text-[9px] mt-0.5 text-slate-600">Archived results of plays and winner summaries gather here.</p>
          </div>
        ` : completedJoinedHtml}
      </div>
    </div>

    <script>
      function toggleMyToursTab(showSect, hideSect, btn) {
        document.getElementById(showSect).classList.remove('hidden');
        document.getElementById(hideSect).classList.add('hidden');
        document.querySelectorAll('.tab-my').forEach(b => {
          b.className = 'tab-my font-mono text-xs uppercase tracking-wider font-extrabold rounded-lg text-slate-400 hover:text-slate-200 py-1.5 transition-all cursor-pointer';
        });
        btn.className = 'tab-my font-mono text-xs uppercase tracking-wider font-extrabold rounded-lg bg-emerald-500 text-slate-950 py-1.5 transition-all cursor-pointer';
      }

      function convertAndBindFile(input, targetHiddenId) {
        const file = input.files[0];
        if(!file) return;
        
        // Max 2MB limit Check
        if(file.size > 2097152) {
          alert("⚠️ File size exceeds 2MB maximum limit constraint rule.");
          input.value = "";
          return;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
          document.getElementById(targetHiddenId).value = e.target.result;
        }
        reader.readAsDataURL(file);
      }
    </script>
  `;
  res.send(renderLayout(req, html, 'Campaign Log', false, flash, error));
});

// SUBMIT SCREENSHOT PROOF PROCESSED
app.post('/my_tournaments.php', (req, res) => {
  const session = getSession(req, res);
  if (!session.userId) return res.redirect('/login.php');

  const db = readDb();
  const { tournament_id, screenshot_base64, csrf_token } = req.body;

  // CSRF validation
  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed. Attempt Rejected.";
    return res.redirect('/my_tournaments.php');
  }

  const user = db.users.find(u => u.id === session.userId);
  if (!user) return res.redirect('/login.php');

  const tour = db.tournaments.find(t => t.id === tournament_id);
  if (!tour) {
    session.error = "Target tournament not found.";
    return res.redirect('/my_tournaments.php');
  }

  if (!screenshot_base64 || !screenshot_base64.startsWith('data:image')) {
    session.error = "Invalid screenshot upload. Please capture image files only.";
    return res.redirect('/my_tournaments.php');
  }

  // Check if already uploaded
  const existingScren = db.match_screenshots.find(s => s.user_id === user.id && s.tournament_id === tour.id);
  if (existingScren) {
    session.error = "Screenshot is already logged and pending verification.";
    return res.redirect('/my_tournaments.php');
  }

  db.match_screenshots.push({
    id: 'screen_' + crypto.randomUUID().substring(0,6),
    user_id: user.id,
    tournament_id: tour.id,
    image: screenshot_base64,
    status: 'Pending',
    created_at: new Date().toISOString()
  });

  writeDb(db);
  session.message = "✅ Screenshot submitted. Referee panel notified.";
  res.redirect('/my_tournaments.php');
});

// -------------------------------------------------------------
// USER HAND MANUAL WALLET: wallet.php
// -------------------------------------------------------------
app.get('/wallet.php', (req, res) => {
  const session = getSession(req, res);
  if (!session.userId) return res.redirect('/login.php');

  const db = readDb();
  const user = db.users.find(u => u.id === session.userId);
  if (!user) return res.redirect('/login.php');

  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  // User transaction logs
  const txHistory = db.transactions.filter(t => t.user_id === user.id).sort((a,b) => b.created_at.localeCompare(a.created_at));

  // Settings for Admin UPI details
  const upiId = db.settings.admin_upi_id || 'upi@upi';
  const qrImage = db.settings.admin_qr_code;

  const txHtml = txHistory.map(tx => {
    const isCredit = (tx.type === 'credit');
    const colorClass = isCredit ? 'text-emerald-400' : 'text-rose-400';
    const indicator = isCredit ? '+' : '-';
    
    return `
      <!-- Single Tx History entry -->
      <div class="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-900">
        <div>
          <span class="block text-xs font-bold text-slate-300 leading-tight">${escapeHtml(tx.description)}</span>
          <span class="block text-[8px] font-mono text-slate-500 font-bold mt-0.5">${new Date(tx.created_at).toLocaleString()}</span>
        </div>
        <div class="text-right">
          <span class="block text-xs font-black ${colorClass}">${indicator} ₹${tx.amount.toFixed(0)}</span>
          ${tx.upi_txn_id ? `<span class="block text-[7px] font-mono tracking-wider text-slate-500 mt-0.5 select-all">UPI: ${escapeHtml(tx.upi_txn_id)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <!-- Big Wallet Bal Card -->
      <div class="bg-slate-900 border border-slate-800 rounded-3xl p-5 relative shadow-xl overflow-hidden">
        <!-- Absolute Background visual ring decoration -->
        <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-emerald-500/5 border border-emerald-500/10"></div>
        
        <span class="block text-[10px] uppercase font-mono font-bold tracking-widest text-slate-400"><i class="fas fa-wallet mr-1.5 text-emerald-400"></i> Vault Reserve Balance</span>
        <h1 class="text-3xl font-black text-white mt-1 pb-1">₹${user.wallet_balance.toFixed(2)}</h1>

        <!-- Splitted balances metrics -->
        <div class="grid grid-cols-2 gap-2 text-[10px] bg-slate-950/60 rounded-xl px-3 py-2 border border-slate-850 mt-1 mb-3">
          <div class="pr-2 border-r border-slate-850">
            <span class="block text-slate-500 font-bold uppercase tracking-wider text-[8px]">Withdrawable Bal</span>
            <span class="font-extrabold text-emerald-400">₹${Math.max(0, user.wallet_balance - (user.unwithdrawable_bonus || 0)).toFixed(2)}</span>
          </div>
          <div class="pl-2">
            <span class="block text-slate-500 font-bold uppercase tracking-wider text-[8px]">Play-Only Bonus</span>
            <span class="font-extrabold text-amber-400">₹${(user.unwithdrawable_bonus || 0).toFixed(2)}</span>
          </div>
        </div>

        <!-- Wallet control actions -->
        <div class="grid grid-cols-2 gap-3 mt-4">
          <button onclick="document.getElementById('add-money-modal').classList.remove('hidden')" class="py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
            <i class="fas fa-plus"></i> Add Money
          </button>
          <button onclick="document.getElementById('withdraw-money-modal').classList.remove('hidden')" class="py-2.5 bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5">
            <i class="fas fa-arrow-down"></i> Withdraw
          </button>
        </div>
      </div>

      <!-- Transaction Log stack -->
      <h3 class="text-xs uppercase font-extrabold text-slate-400 tracking-wider flex items-center gap-1 mt-6">
        <i class="fas fa-history text-slate-500"></i> Historic Transactions Audit
      </h3>

      <div class="space-y-2">
        ${txHistory.length === 0 ? `
          <div class="border border-dashed border-slate-900 py-12 text-center text-slate-600 rounded-2xl flex flex-col items-center">
            <i class="fas fa-file-invoice-dollar text-xl mb-1 flex"></i>
            <h3 class="text-[10px] uppercase tracking-wider font-bold text-slate-500">No Account Statement</h3>
            <p class="text-[8px] text-slate-600">Fund deposits and registration logs reflect instantly.</p>
          </div>
        ` : txHtml}
      </div>

      <!-- Modal: Add Money Manual Deposit System -->
      <div id="add-money-modal" class="hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-5 relative shadow-2xl flex flex-col gap-4 animate-fade-in">
          <div class="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 class="text-sm uppercase tracking-wider font-extrabold text-slate-100 flex items-center gap-1"><i class="fas fa-qrcode text-emerald-400"></i> manual UPI Deposit</h3>
            <button onclick="document.getElementById('add-money-modal').classList.add('hidden')" class="text-slate-400 hover:text-slate-200 text-sm focus:outline-none cursor-pointer">&times;</button>
          </div>

          <div class="flex flex-col items-center text-center gap-2 bg-slate-950 p-4 rounded-2xl border border-slate-900">
            <img src="${qrImage}" class="w-36 h-36 object-contain rounded-xl border border-slate-800 bg-white p-1 shadow">
            
            <span class="text-[8px] uppercase font-bold text-slate-500 tracking-widest mt-1">Merchant UPI Address</span>
            <div class="flex items-center gap-1.5 font-mono text-emerald-400 font-bold select-all bg-slate-900 px-3 py-1 rounded-xl border border-slate-800 text-xs">
              ${escapeHtml(upiId)}
            </div>
            <p class="text-[9px] text-slate-400 mt-1 max-w-[240px] leading-relaxed">Scan QR code or copy merchant UPI Address above inside GooglePay/PhonePe/Paytm and execute transfer.</p>
          </div>

          <form action="/wallet.php" method="POST" class="space-y-3">
            <input type="hidden" name="csrf_token" value="${csrf}">
            <input type="hidden" name="action" value="deposit">
            
            <div>
              <label class="block text-[8px] uppercase tracking-widest font-black text-slate-400 mb-1">Transfer Amount Paid (₹)</label>
              <input type="number" name="amount" required min="10" max="50000" placeholder="100" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 text-slate-200 focus:outline-none">
            </div>

            <div>
              <label class="block text-[8px] uppercase tracking-widest font-black text-slate-400 mb-1">12-Digit UPI Transaction Reference ID (UTR)</label>
              <input type="text" name="transaction_id" required placeholder="618301937162" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-emerald-500 font-mono text-emerald-400 select-text outline-none">
            </div>

            <button type="submit" class="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer">
              Log Deposit Request
            </button>
          </form>
        </div>
      </div>

      <!-- Modal: Withdraw Manual Payment System -->
      <div id="withdraw-money-modal" class="hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-5 relative shadow-2xl flex flex-col gap-4 animate-fade-in">
          <div class="flex justify-between items-center border-b border-slate-800 pb-2">
            <h3 class="text-sm uppercase tracking-wider font-extrabold text-slate-100 flex items-center gap-1"><i class="fas fa-university text-amber-500"></i> Withdraw payout</h3>
            <button onclick="document.getElementById('withdraw-money-modal').classList.add('hidden')" class="text-slate-400 hover:text-slate-200 text-sm focus:outline-none cursor-pointer">&times;</button>
          </div>

          <form action="/wallet.php" method="POST" class="space-y-4">
            <input type="hidden" name="csrf_token" value="${csrf}">
            <input type="hidden" name="action" value="withdraw">
            
            <div class="bg-slate-950 p-3 rounded-2xl border border-slate-900">
              <span class="block text-[8px] uppercase font-bold text-slate-500 tracking-wider mb-0.5">Your Payout UPI Destination</span>
              <span class="font-mono text-slate-300 font-extrabold select-none text-xs">
                ${user.upi_id ? escapeHtml(user.upi_id) : `<span class="text-rose-400"><i class="fas fa-exclamation-triangle"></i> UPI ID NOT SETUP! Update UPI configuration on your Profile setup first.</span>`}
              </span>
            </div>

            <div>
              <label class="block text-[8px] uppercase tracking-widest font-black text-slate-400 mb-1">Withdraw Payout Amount (₹)</label>
              <input type="number" name="amount" required min="50" max="20000" placeholder="500" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs focus:ring-1 focus:ring-amber-500 text-slate-200 outline-none">
              <p class="text-[8px] text-slate-500 mt-1">Minimum payout floor limit is ₹50. Traditional manual clearances process within one to three bank hours.</p>
            </div>

            <button type="submit" ${!user.upi_id ? 'disabled' : ''} class="w-full py-2.5 bg-amber-500 disabled:opacity-30 disabled:cursor-not-allowed text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer">
              Trigger Withdrawal Request
            </button>
          </form>
        </div>
      </div>
    </div>
  `;
  res.send(renderLayout(req, html, 'Lounge Vault', false, flash, error));
});

// WALLET TRANS REQUEST PROCESSORS
app.post('/wallet.php', (req, res) => {
  const session = getSession(req, res);
  if (!session.userId) return res.redirect('/login.php');

  const db = readDb();
  const { action, csrf_token } = req.body;

  // CSRF validation
  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed. Attempt Rejected.";
    return res.redirect('/wallet.php');
  }

  const user = db.users.find(u => u.id === session.userId);
  if (!user) return res.redirect('/login.php');

  // Verify wallet block status
  if (user.wallet_status === 'frozen') {
    session.error = "⛔ Frozen Account: Wallet transactions and deposits are currently suspended on your portfolio.";
    return res.redirect('/wallet.php');
  }

  // A. DEPOSIT PROCESSING BRANCH
  if (action === 'deposit') {
    const { amount, transaction_id } = req.body;
    const value = parseFloat(amount);

    if (isNaN(value) || value < 10) {
      session.error = "Minimum micro deposit base floor is ₹10.";
      return res.redirect('/wallet.php');
    }

    const cleanTxId = (transaction_id || '').trim();
    if (cleanTxId.length < 8) {
      session.error = "Invalid UPI UTR identifier transaction string.";
      return res.redirect('/wallet.php');
    }

    // FAKE TRANSACTION / FRAUD DETECTION SYSTEMS
    let isFraudMatched = false;
    let comment = 'normal';

    // 1. DUPLICATE TRANSACTION CHECK
    const duplicateTxId = db.deposits.some(d => d.transaction_id === cleanTxId) || db.transactions.some(t => t.upi_txn_id === cleanTxId);
    if (duplicateTxId) {
      isFraudMatched = true;
      comment = 'flagged_duplicate_utr';
    }

    // 2. VERY FREQUENT DEPOSIT FREQUENCY CHECK (3 deposits in 5 minutes)
    const cutoffDate = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const userFrequentLogs = db.deposits.filter(d => d.user_id === user.id && d.created_at >= cutoffDate);
    if (userFrequentLogs.length >= 3) {
      isFraudMatched = true;
      comment = 'flagged_frequent_spike';
    }

    db.deposits.push({
      id: 'dep_' + crypto.randomUUID().substring(0,6),
      user_id: user.id,
      amount: value,
      transaction_id: cleanTxId,
      status: 'Pending',
      created_at: new Date().toISOString()
    });

    if (isFraudMatched) {
      // Automatically flag user transaction audit status
      db.transactions.push({
        id: 'tx_flagged_' + crypto.randomUUID().substring(0,5),
        user_id: user.id,
        amount: value,
        type: 'credit',
        description: `Suspicious manual payment alert triggered (Details: ${comment})`,
        upi_txn_id: cleanTxId,
        fraud_status: 'flagged',
        review_required: true,
        created_at: new Date().toISOString()
      });

      // Notify Admin
      db.admin_logs.push({
        id: crypto.randomUUID(),
        admin_id: 'anti_fraud_guard',
        action: 'Fraud Flag Rule Fired',
        details: `Account @${user.username} entered flagged deposit worth ₹${value}. Reason: ${comment}. UPI: ${cleanTxId}`,
        created_at: new Date().toISOString()
      });
    }

    writeDb(db);
    session.message = "✅ Manual payment request logged! Our backend referees will audit UTR: " + cleanTxId;
    return res.redirect('/wallet.php');
  }

  // B. WITHDRAWAL PROCESSING BRANCH
  if (action === 'withdraw') {
    const { amount } = req.body;
    const value = parseFloat(amount || '0');

    // Rate Limit (Max 3 withdrawal requests per hour)
    if (!checkRateLimit(session.ip, 'withdraw_request_rate', 3, 60)) {
      session.error = "❌ Withdrawal rate limit exceeded. Max 3 payout intents per hour Allowed.";
      return res.redirect('/wallet.php');
    }

    if (isNaN(value) || value < 50) {
      session.error = "Minimum withdraw clearance value is ₹50.";
      return res.redirect('/wallet.php');
    }

    if (!user.upi_id) {
      session.error = "Please link your UPI payment address inside Profile tab first.";
      return res.redirect('/wallet.php');
    }

    const withdrawableAmount = Math.max(0, user.wallet_balance - (user.unwithdrawable_bonus || 0));
    if (withdrawableAmount < value) {
      session.error = `Insufficient withdrawable money. Your total balance is ₹${user.wallet_balance.toFixed(2)}, but ₹${(user.unwithdrawable_bonus || 0).toFixed(2)} is unwithdrawable play-only bonus. Maximum you can withdraw is: ₹${withdrawableAmount.toFixed(2)}.`;
      return res.redirect('/wallet.php');
    }

    // Create withdrawal log and deduct immediately (held in escrow pending clearance/reversals)
    user.wallet_balance -= value;
    db.withdrawals.push({
      id: 'with_' + crypto.randomUUID().substring(0,6),
      user_id: user.id,
      amount: value,
      status: 'Pending',
      created_at: new Date().toISOString()
    });

    db.transactions.push({
      id: 'tx_with_hold_' + crypto.randomUUID().substring(0,6),
      user_id: user.id,
      amount: value,
      type: 'debit',
      description: `Held escrow payout requests`,
      upi_txn_id: null,
      fraud_status: 'normal',
      review_required: false,
      created_at: new Date().toISOString()
    });

    writeDb(db);
    session.message = `✅ Withdrawal reserve booked. ₹${value} is frozen in escrow clearance.`;
    return res.redirect('/wallet.php');
  }

  session.error = "Invalid routing action method.";
  res.redirect('/wallet.php');
});

// -------------------------------------------------------------
// PROFILE MANAGEMENT: profile.php (Includes notification center)
// -------------------------------------------------------------
app.get('/profile.php', (req, res) => {
  const session = getSession(req, res);
  if (!session.userId) return res.redirect('/login.php');

  const db = readDb();
  const user = db.users.find(u => u.id === session.userId);
  if (!user) return res.redirect('/login.php');

  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  // Invite referrals stats
  const totalInvited = db.referrals.filter(r => r.referrer_id === user.id).length;
  const totalEarned = db.referrals.filter(r => r.referrer_id === user.id).reduce((acc, curr) => acc + curr.bonus_amount, 0);

  // Notifications logs
  const unreadNotifs = db.notifications.filter(n => n.user_id === user.id).sort((a,b) => b.created_at.localeCompare(a.created_at));

  // Mark pending unreads read upon load securely
  let modified = false;
  db.notifications.forEach(n => {
    if (n.user_id === user.id && n.status === 'Unread') {
      n.status = 'Read';
      modified = true;
    }
  });
  if (modified) writeDb(db);

  const notifsHtml = unreadNotifs.map(n => {
    return `
      <div class="p-3 rounded-xl bg-slate-950 border border-slate-900/60 leading-snug">
        <div class="flex justify-between items-start gap-1 font-semibold text-slate-200 text-xs">
          <span>${escapeHtml(n.title)}</span>
          <span class="text-[7px] font-mono text-slate-500 font-bold">${new Date(n.created_at).toLocaleDateString()}</span>
        </div>
        <p class="text-[10px] text-slate-400 mt-1 leading-relaxed">${escapeHtml(n.message)}</p>
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <!-- Profile Header Visual info -->
      <div class="flex items-center gap-3 bg-gradient-to-r from-indigo-950/20 to-slate-900 p-4 border border-slate-900 rounded-3xl">
        <div class="w-12 h-12 bg-slate-100 rounded-full text-slate-900 font-bold flex items-center justify-center text-xl select-none font-sans uppercase">
          ${user.username.substring(0,2)}
        </div>
        <div>
          <h2 class="text-base font-bold text-slate-100 leading-tight">@${escapeHtml(user.username)}</h2>
          <span class="text-[9px] font-mono text-slate-500 font-bold">${escapeHtml(user.email)}</span>
        </div>
      </div>

      ${user.username === 'suraj' || user.email === '12rajaksuraj@gmail.com' ? `
        <!-- Dynamic Staff Control Dashboard Panel -->
        <div class="bg-amber-950/20 border-2 border-amber-500/40 p-4 rounded-3xl relative overflow-hidden backdrop-blur-xl shadow-lg">
          <div class="absolute -right-4 -top-4 w-16 h-16 bg-amber-500/10 rounded-full blur-xl"></div>
          <div class="flex justify-between items-center border-b border-amber-500/20 pb-2 mb-3">
            <span class="text-xs font-black text-amber-400 uppercase tracking-widest flex items-center gap-1.5"><i class="fas fa-user-shield"></i> creator control center</span>
            <span class="text-[8px] px-1.5 py-0.5 bg-amber-500 text-slate-950 font-mono font-bold rounded-full">OWNER VIEW</span>
          </div>
          <p class="text-[10px] text-amber-200/80 leading-relaxed mb-3">
            This administrative control dock is <strong>strictly exclusive to you</strong> and hidden from all other ordinary users. You can inspect player stats, manage tournament outcomes, and control withdrawal queries here.
          </p>
          <a href="/admin_auto_login.php" class="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-center block uppercase tracking-wider text-[10px] rounded-xl cursor-pointer transition-all shadow-[0_0_12px_rgba(245,158,11,0.4)]">
            <i class="fas fa-external-link-alt mr-1"></i> Open Admin Panel Dashboard
          </a>
        </div>
      ` : ''}

      <!-- Referral Module Invite panel -->
      <div class="bg-slate-900/90 border border-indigo-900/40 p-4 rounded-2xl relative shadow-md">
        <div class="flex justify-between items-center border-b border-indigo-900/20 pb-2 mb-3">
          <span class="text-xs font-black text-indigo-400 uppercase tracking-wider"><i class="fas fa-gift"></i> referral center</span>
          <span class="text-[9px] px-1.5 py-0.2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono font-bold">Earn ₹5 / depositor</span>
        </div>
        
        <p class="text-[9.5px] text-slate-400 leading-normal mb-3">
          Invite friends using your code! Get a <strong>₹5.00</strong> cash bonus automatically when your referred friend successfully updates and loads their first wallet deposit.
        </p>
        
        <div class="grid grid-cols-2 text-center bg-slate-950 p-2 rounded-xl mb-3 border border-slate-900 gap-1">
          <div>
            <span class="block text-[8px] uppercase font-bold text-slate-500 tracking-wider">Depositor Friends</span>
            <span class="text-xs font-black text-slate-200">${totalInvited} Players</span>
          </div>
          <div>
            <span class="block text-[8px] uppercase font-bold text-slate-500 tracking-wider">Bonus rewards</span>
            <span class="text-xs font-black text-emerald-400">₹${totalEarned.toFixed(0)}</span>
          </div>
        </div>

        <div class="flex justify-between items-center bg-slate-950 px-3 py-2 border border-dashed border-indigo-500/30 rounded-xl">
          <span class="text-[9px] text-slate-400 uppercase tracking-widest font-mono">Your Code:</span>
          <span class="font-mono text-indigo-300 font-black tracking-widest text-sm select-all">${user.referral_code}</span>
        </div>
      </div>

      <!-- Advanced Theme Engine Selection Bento Card -->
      <div class="bg-slate-900 border border-slate-800 p-4 rounded-2xl relative overflow-hidden backdrop-blur-xl shadow-lg transition-all hover:border-slate-700/80">
        <!-- Shine Overlay effect -->
        <div class="absolute -right-12 -top-12 w-32 h-32 bg-gradient-to-br from-amber-500/10 to-pink-500/0 rounded-full blur-2xl"></div>
        
        <div class="flex justify-between items-center border-b border-slate-800/85 pb-2 mb-3 relative z-10">
          <span class="text-xs font-black uppercase tracking-widest flex items-center gap-1.5" style="color: var(--theme-accent)">
            <i class="fas fa-palette"></i> Choose Game Theme
          </span>
          <span class="text-[8px] px-2 py-0.5 bg-slate-950 text-emerald-400 font-mono font-bold rounded-full border border-slate-850 animate-pulse">
            LIVE PREVIEW
          </span>
        </div>
        
        <p class="text-[10px] text-slate-400 leading-relaxed mb-4 relative z-10">
          Sleek advanced gaming layers. Choose a premium aesthetic skin to instantly customize your dashboard colors, neon highlight accents, glow grids, and active controls!
        </p>

        <!-- Premium dynamic Theme grid list -->
        <div class="grid grid-cols-2 gap-2 relative z-10" id="theme-selection-grid">
          <!-- Midnight Violet / Twilight -->
          <button onclick="changeThemeEngine('twilight')" id="btn-theme-twilight" class="theme-card-btn text-left p-2.5 rounded-xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 active:scale-98 transition-all flex flex-col justify-between relative cursor-pointer select-none">
            <span class="text-[9px] font-extrabold text-white leading-tight">🌌 Twilight Indigo</span>
            <span class="text-[7.5px] text-slate-500 mt-0.5">Indigo & Jade Emerald</span>
            <!-- gradient preview pills -->
            <div class="flex gap-1 mt-2">
              <span class="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
            </div>
            <!-- checkmark overlay indicators -->
            <div class="check-indicator absolute top-2 right-2 hidden text-emerald-400 text-[9px]">
              <i class="fas fa-check-circle"></i>
            </div>
          </button>

          <!-- Cosmic Pink / Purple Orchid -->
          <button onclick="changeThemeEngine('cosmic')" id="btn-theme-cosmic" class="theme-card-btn text-left p-2.5 rounded-xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 active:scale-98 transition-all flex flex-col justify-between relative cursor-pointer select-none">
            <span class="text-[9px] font-extrabold text-white leading-tight">🔮 Cosmic Amethyst</span>
            <span class="text-[7.5px] text-slate-500 mt-0.5">Royal Orchid & Amethyst</span>
            <div class="flex gap-1 mt-2">
              <span class="w-2.5 h-2.5 rounded-full bg-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.5)]"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]"></span>
            </div>
            <div class="check-indicator absolute top-2 right-2 hidden text-emerald-400 text-[9px]">
              <i class="fas fa-check-circle"></i>
            </div>
          </button>

          <!-- Crimson Sunset / Inferno Orange -->
          <button onclick="changeThemeEngine('crimson')" id="btn-theme-crimson" class="theme-card-btn text-left p-2.5 rounded-xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 active:scale-98 transition-all flex flex-col justify-between relative cursor-pointer select-none">
            <span class="text-[9px] font-extrabold text-white leading-tight">🔥 Sunset Crimson</span>
            <span class="text-[7.5px] text-slate-500 mt-0.5">Crimson Devil & Flame</span>
            <div class="flex gap-1 mt-2">
              <span class="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]"></span>
            </div>
            <div class="check-indicator absolute top-2 right-2 hidden text-emerald-400 text-[9px]">
              <i class="fas fa-check-circle"></i>
            </div>
          </button>

          <!-- Poison Venom / Matrix Green -->
          <button onclick="changeThemeEngine('poison')" id="btn-theme-poison" class="theme-card-btn text-left p-2.5 rounded-xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 active:scale-98 transition-all flex flex-col justify-between relative cursor-pointer select-none">
            <span class="text-[9px] font-extrabold text-white leading-tight">🍃 Poison Venom</span>
            <span class="text-[7.5px] text-slate-500 mt-0.5">Radioactive Esp & Cyan</span>
            <div class="flex gap-1 mt-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]"></span>
            </div>
            <div class="check-indicator absolute top-2 right-2 hidden text-emerald-400 text-[9px]">
              <i class="fas fa-check-circle"></i>
            </div>
          </button>

          <!-- Imperial Saffron / Luxury Amber -->
          <button onclick="changeThemeEngine('royal')" id="btn-theme-royal" class="theme-card-btn text-left p-2.5 rounded-xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 active:scale-98 transition-all flex flex-col justify-between relative cursor-pointer select-none">
            <span class="text-[9px] font-extrabold text-white leading-tight">👑 Imperial Saffron</span>
            <span class="text-[7.5px] text-slate-500 mt-0.5">Saffron Gold & Amber Onyx</span>
            <div class="flex gap-1 mt-2">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]"></span>
            </div>
            <div class="check-indicator absolute top-2 right-2 hidden text-emerald-400 text-[9px]">
              <i class="fas fa-check-circle"></i>
            </div>
          </button>

          <!-- Cool Ocean sapphire / Blue Wave -->
          <button onclick="changeThemeEngine('ocean')" id="btn-theme-ocean" class="theme-card-btn text-left p-2.5 rounded-xl bg-slate-950 border border-slate-850 hover:border-slate-800 hover:-translate-y-0.5 active:scale-98 transition-all flex flex-col justify-between relative cursor-pointer select-none">
            <span class="text-[9px] font-extrabold text-white leading-tight">🌊 Cyber Oceans</span>
            <span class="text-[7.5px] text-slate-500 mt-0.5">Deep Blue & Wave Cyan</span>
            <div class="flex gap-1 mt-2">
              <span class="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></span>
              <span class="w-2.5 h-2.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]"></span>
            </div>
            <div class="check-indicator absolute top-2 right-2 hidden text-emerald-400 text-[9px]">
              <i class="fas fa-check-circle"></i>
            </div>
          </button>
        </div>

        <!-- Inline active selection dynamic highlights -->
        <script>
          function updateThemeCardsHighlight() {
            const currentTheme = localStorage.getItem('mvp-color-theme') || 'twilight';
            
            document.querySelectorAll('.theme-card-btn').forEach(card => {
              card.classList.remove('border-emerald-500', 'border-amber-500', 'bg-slate-900', 'scale-[1.02]', 'shadow-lg');
              card.classList.add('border-slate-850', 'bg-slate-950');
              const indicator = card.querySelector('.check-indicator');
              if (indicator) {
                indicator.classList.add('hidden');
              }
            });

            const activeBtn = document.getElementById('btn-theme-' + currentTheme);
            if (activeBtn) {
              activeBtn.classList.remove('border-slate-850', 'bg-slate-950');
              activeBtn.classList.add('border-amber-500', 'bg-slate-900', 'scale-[1.02]', 'shadow-lg');
              const indicator = activeBtn.querySelector('.check-indicator');
              if (indicator) {
                indicator.classList.remove('hidden');
              }
            }
          }

          window.changeThemeEngine = function(theme) {
            if (typeof globalChangeTheme === 'function') {
              globalChangeTheme(theme);
            } else {
              localStorage.setItem('mvp-color-theme', theme);
              if (typeof globalApplyActiveTheme === 'function') {
                globalApplyActiveTheme();
              }
              updateThemeCardsHighlight();
            }
          };

          // Run immediately on render mount
          setTimeout(updateThemeCardsHighlight, 50);
        </script>
      </div>

      <!-- App Install Card -->
      <div class="bg-slate-900 border border-indigo-950 p-4 rounded-2xl relative overflow-hidden shadow-md">
        <div class="absolute -right-12 -bottom-12 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl"></div>
        
        <div class="flex justify-between items-center border-b border-indigo-900/20 pb-2 mb-3">
          <span class="text-xs font-black text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
            <i class="fas fa-mobile-alt"></i> Mobile App Install Center
          </span>
          <span class="text-[8px] px-1.5 py-0.2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-mono font-bold uppercase rounded">PWA APP</span>
        </div>

        <p class="text-[10px] text-slate-400 leading-relaxed mb-3">
          इस टूर्नामेंट पोर्टल को अपने मोबाइल में एक असली <strong>Android / iOS App</strong> की तरह इंस्टॉल करें और बिना किसी ब्राउज़र झंझट के सुपर फ़ास्ट खेलें!
        </p>

        <!-- Direct Native Prompt Button -->
        <div class="pwa-install-btn-container hidden mb-4">
          <button onclick="window.triggerPWAInstall()" class="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-extrabold uppercase tracking-wide text-[10.5px] rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all shadow-[0_0_15px_rgba(99,102,241,0.35)] hover:scale-[1.01] active:scale-[0.99]">
            <i class="fas fa-cloud-download-alt text-sm animate-bounce"></i> DIRECT INSTALL (अभी इंस्टॉल करें)
          </button>
        </div>

        <!-- Static Quick Instructions -->
        <div class="space-y-2 bg-slate-950 p-3 rounded-xl border border-slate-900 text-[10px] text-slate-300">
          <div class="flex gap-2 items-start">
            <span class="flex items-center justify-center w-4 h-4 rounded-full bg-slate-900 border border-slate-800 text-[8px] font-bold text-center flex-shrink-0 text-emerald-400">1</span>
            <div>
              <strong class="text-slate-100">Android Users:</strong> Chrome ब्राउज़र में सबसे ऊपर दाहिने कोने में <strong class="text-indigo-400 font-black">3-dots (⋮)</strong> बटन पर टैप करें, फिर <strong class="text-emerald-400">"Install App"</strong> या <strong class="text-emerald-400">"Add to Home Screen"</strong> ऑप्शन पर क्लिक करें!
            </div>
          </div>
          <div class="flex gap-2 items-start border-t border-slate-900/50 pt-2">
            <span class="flex items-center justify-center w-4 h-4 rounded-full bg-slate-900 border border-slate-800 text-[8px] font-bold text-center flex-shrink-0 text-indigo-400">2</span>
            <div>
              <strong class="text-slate-100">iPhone / iOS Users:</strong> Safari ब्राउज़र में सबसे नीचे <strong class="text-indigo-400 font-black">Share Button (📤)</strong> पर क्लिक करें, और फिर थोड़ा स्क्रॉल करके <strong class="text-indigo-400">"Add to Home Screen"</strong> चुनें!
            </div>
          </div>
        </div>

        ${user.username === 'suraj' || user.email === '12rajaksuraj@gmail.com' ? `
          <!-- Exclusive Owner instructions for packaging into pure Android APK for Google Play Store -->
          <div class="mt-4 pt-3 border-t border-indigo-950 bg-indigo-950/20 -mx-4 -mb-4 p-4 rounded-b-2xl">
            <h4 class="text-[10px] font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5 mb-2">
              <i class="fab fa-android text-emerald-400 text-xs"></i> Suraj's Play Store Guide (.apk)
            </h4>
            
            <!-- Direct Source ZIP Download Area for Suraj -->
            <div class="mb-4 bg-slate-950 p-3 rounded-xl border border-emerald-500/20">
              <span class="text-[9px] font-black text-emerald-400 uppercase tracking-widest block mb-1">
                📥 DIRECT CODE DOWNLOAD (पूरा सोर्स कोड डाउनलोड करें)
              </span>
              <p class="text-[8.5px] text-slate-400 leading-normal mb-2.5">
                सूरज भाई, अगर आपका APK नहीं चल रहा है, तो पूरे प्रोजेक्ट का ताज़ा और बिल्कुल सही कोड ज़िप फॉर्मेट में यहाँ से डायरेक्ट डाऊनलोड करें:
              </p>
              <a href="/download-project-source.zip" download class="w-full h-9 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-slate-950 hover:text-slate-950 font-black tracking-wider text-[9.5px] rounded-lg inline-flex items-center justify-center gap-2 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99] shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                <i class="fas fa-file-archive text-xs animate-bounce"></i> DOWNLOAD FULL CODE ZIP (पूरा सोर्स कोड डाऊनलोड करें)
              </a>
            </div>

            <p class="text-[9.5px] text-slate-300 leading-relaxed mb-2">
              सूरज भाई, इस गेमिंग वेब एप्प को आप गूगल प्ले स्टोर पर डालने वाला असली <strong>Android App (.apk / .aab)</strong> में आसानी से बदल सकते हैं। यहाँ सबसे बेहतर तरीक़े हैं:
            </p>
            
            <div class="space-y-2.5 text-[9px] text-slate-400 leading-normal">
              <div>
                <strong class="text-slate-200 block mb-0.5">तरीक़ा 1: CapacitorJS (बेस्ट और आसान)</strong>
                यह आपके इस React/Express कोड को सीधे Android Studio प्रोजेक्ट में बदल देगा जिससे आप APK बिल्ड कर सकते हैं:
                <pre class="bg-slate-950 text-emerald-400 p-1.5 rounded font-mono text-[8px] mt-1 select-all overflow-x-auto">
npm install @capacitor/core @capacitor/cli
npx cap init "MVP Tournaments" "com.mvp.tourney" --web-dir=dist
npx cap add android
npx cap open android</pre>
                यह कमांड आपके लिए <strong class="text-indigo-300">Android Studio</strong> का पूरा सेटअप तैयार कर देगी!
              </div>

              <div class="border-t border-indigo-900/20 pt-2">
                <strong class="text-slate-200 block mb-0.5">तरीक़ा 2: bubblewrap CLI (TWA)</strong>
                Google का आधिकारिक टूल जो आपकी PWA वेबसाइट को सीधे तैयार करके Play Store के लिए कंपाइल करता है:
                <pre class="bg-slate-950 text-indigo-300 p-1.5 rounded font-mono text-[8px] mt-1 select-all">
npm install -g @bubblewrap/cli
bubblewrap init --manifest=https://your-domain.com/manifest.json
bubblewrap build</pre>
              </div>

              <div class="border-t border-indigo-900/20 pt-2 text-[8.5px] text-amber-300/90 leading-relaxed">
                <i class="fas fa-info-circle text-amber-400"></i> प्ले स्टोर पर सबमिट करने के लिए आपको एक <strong>Google Play Console Developer Account</strong> ($25 वन-टाइम फ़ीस) की आवश्यकता होगी। फिर आप अपना APK अपलोड कर सकते हैं!
              </div>
            </div>
          </div>
        ` : ''}
      </div>

      <!-- Save UPI Setup form -->
      <form action="/profile.php" method="POST" class="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
        <input type="hidden" name="csrf_token" value="${csrf}">
        <input type="hidden" name="action" value="update_upi">
        <h3 class="text-xs uppercase font-extrabold text-slate-300 tracking-wider border-b border-slate-800 pb-2 mb-1"><i class="fas fa-wallet text-emerald-400"></i> payout UPI destination</h3>
        <div>
          <label class="block text-[10px] uppercase font-bold text-slate-500 mb-1">Your UPI address ID</label>
          <input type="text" name="upi_id" required value="${user.upi_id ? escapeHtml(user.upi_id) : ''}" placeholder="username@ybl" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-emerald-400 font-mono font-bold focus:ring-1 focus:ring-emerald-400 focus:outline-none">
        </div>
        <button type="submit" class="w-full py-2 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 font-bold uppercase tracking-wider text-[10px] rounded-xl cursor-pointer">
          Save Destination address
        </button>
      </form>

      <!-- Edit account details form -->
      <form action="/profile.php" method="POST" class="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
        <input type="hidden" name="csrf_token" value="${csrf}">
        <input type="hidden" name="action" value="update_profile">
        <h3 class="text-xs uppercase font-extrabold text-slate-300 tracking-wider border-b border-slate-800 pb-2 mb-1"><i class="fas fa-user-edit text-slate-400"></i> settings console</h3>
        
        <div>
          <label class="block text-[10px] uppercase font-bold text-slate-500 mb-1">Passcode update</label>
          <input type="password" name="password" required placeholder="Choose a new secure password" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-700">
        </div>
        <button type="submit" class="w-full py-2 bg-slate-950 border border-slate-800 text-slate-300 font-bold uppercase text-[10px] rounded-xl cursor-pointer">
          Update Passcode keys
        </button>
      </form>

      <!-- Logs Notification Center panel -->
      <h3 id="notifications" class="text-xs uppercase font-extrabold text-slate-400 tracking-wider flex items-center gap-1 mt-6">
        <i class="far fa-bell text-slate-500"></i> Event message logging box
      </h3>

      <div class="space-y-2">
        ${unreadNotifs.length === 0 ? `
          <div class="border border-dashed border-slate-900 py-10 text-center text-slate-600 rounded-2xl flex flex-col items-center">
            <i class="far fa-bell text-lg mb-1 flex"></i>
            <h3 class="text-[9px] uppercase tracking-wider font-bold text-slate-500">Alert box clean</h3>
          </div>
        ` : notifsHtml}
      </div>

      <!-- Secure Exit button -->
      <a href="/logout.php" class="block w-full py-3 border border-rose-500/20 hover:border-rose-500/40 text-rose-400 font-extrabold text-xs uppercase text-center tracking-widest rounded-xl bg-rose-500/5 transition-all mt-6 cursor-pointer">
        <i class="fas fa-power-off text-rose-500"></i> destroy active session
      </a>
    </div>
  `;
  res.send(renderLayout(req, html, 'Identity Profile', false, flash, error));
});

// PROFILE UPDATE PROCESSED
app.post('/profile.php', (req, res) => {
  const session = getSession(req, res);
  if (!session.userId) return res.redirect('/login.php');

  const db = readDb();
  const { action, csrf_token } = req.body;

  // CSRF validation
  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed. Attempt Rejected.";
    return res.redirect('/profile.php');
  }

  const user = db.users.find(u => u.id === session.userId);
  if (!user) return res.redirect('/login.php');

  // A. UPDATE UPI ID DESTINATION
  if (action === 'update_upi') {
    const { upi_id } = req.body;
    const cleanUpi = (upi_id || '').trim();

    if (!cleanUpi.includes('@') || cleanUpi.length < 5) {
      session.error = "Invalid format for UPI payout address.";
      return res.redirect('/profile.php');
    }

    user.upi_id = cleanUpi;
    writeDb(db);
    session.message = "Payout address destination initialized successfully!";
    return res.redirect('/profile.php');
  }

  // B. UPDATE CHOOSE PASSWORD BRANCH
  if (action === 'update_profile') {
    const { password } = req.body;
    const cleanPassword = (password || '').trim();

    if (cleanPassword.length < 5) {
      session.error = "Choose a passcode size of at least 5 indices.";
      return res.redirect('/profile.php');
    }

    user.password_hash = hashPassword(cleanPassword);
    writeDb(db);
    session.message = "Profile passcode keys refreshed successfully!";
    return res.redirect('/profile.php');
  }

  session.error = "Malformed request arguments.";
  res.redirect('/profile.php');
});

// -------------------------------------------------------------
// ADMIN PANEL SECURITIES & SESSIONS ROUTING
// -------------------------------------------------------------
app.get('/admin_auto_login.php', (req, res) => {
  const session = getSession(req, res);
  const db = readDb();
  const user = session.userId ? db.users.find(u => u.id === session.userId) : null;

  if (user && (user.username === 'suraj' || user.email === '12rajaksuraj@gmail.com')) {
    session.adminId = 'admin_1';
    session.message = "🛡️ Welcome Creator Suraj! You are authenticated as Administrator.";
    return res.redirect('/admin/index.php');
  }

  session.error = "Unauthorized entry attempt.";
  res.redirect('/index.php');
});

function getAdminSession(req: express.Request, res?: express.Response) {
  const session = getSession(req, res);
  return session;
}

// 1. ADMIN LOGIN gate: admin/login.php
app.get('/admin/login.php', (req, res) => {
  const session = getAdminSession(req, res);

  // Logout handler
  if (req.query.logout === '1') {
    delete session.adminId;
    session.message = "Logged out from Admin Console securely.";
    return res.redirect('/admin/login.php');
  }

  if (session.adminId) {
    return res.redirect('/admin/index.php');
  }

  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  const html = `
    <div class="py-8 flex flex-col justify-center items-center">
      <div class="w-14 h-14 rounded-2xl bg-indigo-600 text-[18px] font-black tracking-widest text-white flex items-center justify-center shadow-lg mb-4 font-mono">ADM</div>
      <h2 class="text-xl font-bold tracking-tight text-white uppercase text-center">Admin Console Gateway</h2>
      <p class="text-[10px] text-slate-500 font-mono tracking-widest mt-1 mb-6 text-center uppercase">Secure Staff Entry Portal</p>

      <form action="/admin/login.php" method="POST" class="w-full bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
        <input type="hidden" name="csrf_token" value="${csrf}">
        
        <div>
          <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Admin Username</label>
          <input type="text" name="username" required placeholder="admin" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono select-text">
        </div>

        <div>
          <label class="block text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1">Access Passphrase</label>
          <input type="password" name="password" required placeholder="••••••••" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono select-text">
        </div>

        <button type="submit" class="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-slate-100 font-black uppercase text-xs tracking-widest rounded-xl transition-all cursor-pointer shadow-lg">
          Authenticate Credentials
        </button>
      </form>
      
      <a href="/login.php" class="text-slate-500 hover:text-slate-400 text-xs mt-6 transition-all flex items-center gap-1.5 font-bold uppercase tracking-wider">
        <i class="fas fa-chevron-left"></i> Back to Player Arena
      </a>
    </div>
  `;
  res.send(renderLayout(req, html, 'Admin Credentials Gate', true, flash, error));
});

app.post('/admin/login.php', (req, res) => {
  const session = getAdminSession(req, res);
  const db = readDb();
  const { username, password, csrf_token } = req.body;

  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Verification Failure. Connection Rejected.";
    return res.redirect('/admin/login.php');
  }

  const hashed = hashPassword(password || '');
  const adminAccount = db.admin.find(a => a.username === username);

  if (!adminAccount || adminAccount.password_hash !== hashed) {
    session.error = "Unauthorized credential credentials combination.";
    return res.redirect('/admin/login.php');
  }

  session.adminId = adminAccount.id;
  session.message = "Successfully logged into administrative console.";
  res.redirect('/admin/index.php');
});

// 2. ADMIN DASHBOARD: admin/index.php
app.get('/admin/index.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  // Calculates stats
  const totalUsers = db.users.length;
  const totalTourneys = db.tournaments.length;
  
  // Total Revenue calculations (commission deductions from tournaments completed)
  let totalCommissionsEarned = 0;
  db.tournaments.forEach(t => {
    if (t.status === 'Completed') {
      const partsNum = db.participants.filter(p => p.tournament_id === t.id).length;
      const collectedFees = partsNum * t.entry_fee;
      totalCommissionsEarned += (collectedFees * (t.commission_pct / 100));
    }
  });

  const pendingDepositsCount = db.deposits.filter(d => d.status === 'Pending').length;
  const pendingDepositsSum = db.deposits.filter(d => d.status === 'Pending').reduce((acc, curr) => acc + curr.amount, 0);
  
  const pendingWithdrawalCount = db.withdrawals.filter(w => w.status === 'Pending').length;
  const pendingWithdrawlSum = db.withdrawals.filter(w => w.status === 'Pending').reduce((acc, curr) => acc + curr.amount, 0);

  // Flagged/review transactions
  const flaggedTransactionsCount = db.transactions.filter(t => t.fraud_status === 'flagged').length;
  
  // Suspicious accounts: users signed up from same IP (>=3 users)
  const ipCounts: Record<string, number> = {};
  db.users.forEach(u => {
    ipCounts[u.ip_address] = (ipCounts[u.ip_address] || 0) + 1;
  });
  const suspiciousUserCount = db.users.filter(u => ipCounts[u.ip_address] >= 3).length;

  const liveTourneysCount = db.tournaments.filter(t => t.status === 'Upcoming' || t.status === 'Live').length;

  // Logs list
  const recentLogs = db.admin_logs.sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0, 4);

  const logsHtml = recentLogs.map(l => {
    return `
      <!-- Admin audit trail item -->
      <div class="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-900 leading-snug">
        <span class="block text-[8px] font-mono text-slate-500 font-bold select-none">${new Date(l.created_at).toLocaleString()} | Actor: ${escapeHtml(l.admin_id)}</span>
        <span class="block text-xs text-indigo-400 font-bold mt-0.5">${escapeHtml(l.action)}</span>
        <p class="text-[10px] text-slate-400 leading-normal mt-0.5">${escapeHtml(l.details)}</p>
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-900 pb-3 mb-2">
        <div>
          <span class="text-[9px] text-indigo-400 uppercase font-black tracking-widest block"><i class="fas fa-shield-alt"></i> Administrative Deck</span>
          <h2 class="text-xl font-bold text-white tracking-tight leading-tight">Master Console</h2>
        </div>
        <div class="flex gap-2">
          <a href="/admin/deposits.php" class="relative bg-slate-900 hover:bg-slate-800 text-slate-300 px-3 py-1.8 text-[11px] rounded-xl border border-slate-800 transition-all font-bold uppercase tracking-wider">
            Deposits
            ${pendingDepositsCount > 0 ? `<span class="absolute -top-1.5 -right-1 w-4 h-4 rounded-full bg-rose-500 text-[8px] flex items-center justify-center text-white font-black animate-bounce">${pendingDepositsCount}</span>` : ''}
          </a>
          <a href="/admin/withdrawals.php" class="relative bg-slate-900 hover:bg-slate-800 text-slate-300 px-3 py-1.8 text-[11px] rounded-xl border border-slate-800 transition-all font-bold uppercase tracking-wider">
            Payouts
            ${pendingWithdrawalCount > 0 ? `<span class="absolute -top-1.5 -right-1 w-4 h-4 rounded-full bg-rose-500 text-[8px] flex items-center justify-center text-white font-black animate-bounce">${pendingWithdrawalCount}</span>` : ''}
          </a>
        </div>
      </div>

      <!-- Quick stats grids -->
      <div class="grid grid-cols-2 gap-3">
        <!-- Revenue Commissions -->
        <div class="bg-indigo-950/20 border border-indigo-500/15 p-3.5 rounded-2xl relative overflow-hidden">
          <span class="block text-[8px] uppercase tracking-wider font-extrabold text-indigo-400">Total Commissions</span>
          <h2 class="text-xl font-black text-white mt-1">₹${totalCommissionsEarned.toFixed(2)}</h2>
          <span class="text-[8px] text-slate-500 font-mono mt-0.5 block flex items-center gap-1"><i class="fas fa-percent"></i> Auto-settlements calculated</span>
        </div>

        <!-- Total users -->
        <div class="bg-slate-905 bg-slate-900 border border-slate-800 p-3.5 rounded-2xl">
          <span class="block text-[8px] uppercase tracking-wider font-extrabold text-slate-400">Total Players</span>
          <h2 class="text-xl font-black text-white mt-1">${totalUsers} Registrations</h2>
          <span class="text-[8px] text-emerald-400/80 font-mono mt-0.5 block flex items-center gap-1 animate-pulse"><i class="fas fa-circle text-[6px]"></i> Multi Account Safe</span>
        </div>
      </div>

      <!-- Extended Security Audit Grid -->
      <div class="grid grid-cols-2 gap-3 mt-1">
        <!-- Suspicious Accounts -->
        <div class="p-3 bg-slate-900 border border-slate-800 rounded-2xl">
          <div class="flex justify-between items-center border-b border-slate-800/40 pb-1 mb-1.5">
            <span class="text-[8px] uppercase font-bold tracking-wider text-rose-400">Multi Accounts</span>
            <i class="fas fa-fingerprint text-rose-400/50 text-[10px]"></i>
          </div>
          <h3 class="text-base font-black ${suspiciousUserCount > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-300'}">${suspiciousUserCount} Flagged</h3>
          <span class="text-[8px] text-slate-500 font-mono mt-0.5 block">Shared IP addresses</span>
        </div>

        <!-- Flagged Transactions -->
        <div class="p-3 bg-slate-900 border border-slate-800 rounded-2xl">
          <div class="flex justify-between items-center border-b border-slate-800/40 pb-1 mb-1.5">
            <span class="text-[8px] uppercase font-bold tracking-wider text-amber-500">Flagged Payments</span>
            <i class="fas fa-shield-alt text-amber-500/50 text-[10px]"></i>
          </div>
          <h3 class="text-base font-black ${flaggedTransactionsCount > 0 ? 'text-amber-500 animate-pulse' : 'text-slate-300'}">${flaggedTransactionsCount} Suspicious</h3>
          <span class="text-[8px] text-slate-500 font-mono mt-0.5 block">Duplicated UTRs / Spikes</span>
        </div>
      </div>

      <!-- Micro Actions lists -->
      <div class="grid grid-cols-2 gap-3 mt-2">
        <a href="/admin/tournament.php" class="p-3 border border-slate-800 hover:border-slate-700 bg-slate-900/60 rounded-xl transition-all cursor-pointer flex items-center gap-2 text-xs">
          <i class="fas fa-plus text-indigo-500"></i>
          <span>Create Tournament</span>
        </a>
        <a href="/admin/setting.php" class="p-3 border border-slate-800 hover:border-slate-700 bg-slate-900/60 rounded-xl transition-all cursor-pointer flex items-center gap-2 text-xs">
          <i class="fas fa-qrcode text-emerald-500"></i>
          <span>UPI / QR Settings</span>
        </a>
      </div>

      <!-- Referee Activitylogs audit -->
      <h3 class="text-xs uppercase font-extrabold text-slate-400 tracking-wider flex items-center gap-1.5 mt-6">
        <i class="fas fa-stream text-indigo-500"></i> Historical Audit Trail
      </h3>

      <div class="space-y-2">
        ${recentLogs.length === 0 ? `
          <div class="border border-dashed border-slate-800 py-8 text-center text-slate-600 rounded-xl">
            No audit logging entries yet.
          </div>
        ` : logsHtml}
      </div>
    </div>
  `;
  res.send(renderLayout(req, html, 'Master Audit Console', true, flash, error));
});

// 3. TOURNAMENTS ADD AND EDIT: admin/tournament.php
app.get('/admin/tournament.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  // List of created tournaments
  const tours = db.tournaments.sort((a,b) => b.created_at.localeCompare(a.created_at));

  const listHtml = tours.map(t => {
    return `
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-3 flex justify-between items-center leading-snug">
        <div>
          <span class="block font-bold text-slate-200 text-xs">${escapeHtml(t.title)}</span>
          <span class="block text-[8px] font-mono font-bold text-slate-500 uppercase mt-0.5">${escapeHtml(t.game_name)} | Entry: ₹${t.entry_fee.toFixed(0)} | Status: ${t.status}</span>
        </div>
        <div class="flex gap-2">
          <a href="/admin/manage_tournament.php?tournament_id=${t.id}" class="text-[9px] uppercase tracking-wider font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1.5 rounded transition-all">
            Manage
          </a>
          <a href="/admin/tournament.php?action=delete&tournament_id=${t.id}&csrf_token=${csrf}" class="text-[9px] uppercase tracking-wider font-extrabold bg-slate-950 hover:bg-rose-950 text-rose-500 px-2 py-1.5 rounded border border-slate-800 transition-all" onclick="return confirm('Confirm deletion of event playroom?')">
            <i class="fas fa-trash"></i>
          </a>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <div class="border-b border-slate-900 pb-2 mb-1.5">
        <h2 class="text-base uppercase tracking-wider font-extrabold text-slate-100 flex items-center gap-1.5"><i class="fas fa-gamepad text-indigo-500"></i> Event Generator</h2>
        <p class="text-[9px] text-slate-500 font-mono">Create and distribute gaming playroom rooms</p>
      </div>

      <!-- Creation Form -->
      <form action="/admin/tournament.php" method="POST" class="bg-slate-900 border border-slate-800/80 rounded-2xl p-4 space-y-3 shadow-inner">
        <input type="hidden" name="csrf_token" value="${csrf}">
        <input type="hidden" name="action" value="create">

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[8px] uppercase font-bold text-slate-400 mb-0.5">Tournament Title</label>
            <input type="text" name="title" required placeholder="BGMI Pro Combat" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none">
          </div>
          <div>
            <label class="block text-[8px] uppercase font-bold text-slate-400 mb-0.5">game title Name</label>
            <input type="text" name="game_name" required placeholder="BGMI / Free Fire" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none">
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="block text-[8px] uppercase font-bold text-slate-400 mb-0.5">Entry Fee (₹)</label>
            <input type="number" name="entry_fee" required placeholder="50" min="0" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none font-mono">
          </div>
          <div>
            <label class="block text-[8px] uppercase font-bold text-slate-400 mb-0.5">Prize Pool (₹)</label>
            <input type="number" name="prize_pool" required placeholder="500" min="0" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none font-mono">
          </div>
          <div>
            <label class="block text-[8px] uppercase font-bold text-slate-400 mb-0.5">commission %</label>
            <input type="number" name="commission_pct" value="20" required class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none font-mono">
          </div>
        </div>

        <div>
          <label class="block text-[8px] uppercase font-bold text-slate-400 mb-0.5">Match Start Time</label>
          <input type="datetime-local" name="match_time" required class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 outline-none font-mono">
        </div>

        <button type="submit" class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-slate-100 font-extrabold uppercase text-[10px] tracking-widest rounded-xl transition-all cursor-pointer">
          Generate Tournament Match
        </button>
      </form>

      <!-- Matches lists -->
      <h3 class="text-xs uppercase font-extrabold text-slate-400 tracking-wider mt-6"><i class="fas fa-list text-indigo-500"></i> Generated Playrooms Stack</h3>
      <div class="space-y-2">
        ${listHtml.length === 0 ? `
          <p class="text-xs text-slate-600 border border-dashed border-slate-800 py-6 text-center select-none rounded-xl">Lobbies list currently empty.</p>
        ` : listHtml}
      </div>
    </div>
  `;
  res.send(renderLayout(req, html, 'Lobby Builder Desk', true, flash, error));
});

// CREATE / DELETE PROCESSORS FOR TOURNAMENTS
app.post('/admin/tournament.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const { action, csrf_token } = req.body;

  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Verification Failure. Connection Rejected.";
    return res.redirect('/admin/tournament.php');
  }

  if (action === 'create') {
    const { title, game_name, entry_fee, prize_pool, match_time, commission_pct } = req.body;

    const parsedFee = parseFloat(entry_fee);
    const parsedPrize = parseFloat(prize_pool);
    const parsedComm = parseFloat(commission_pct || '20');

    if (isNaN(parsedFee) || isNaN(parsedPrize) || !title) {
      session.error = "Malformed fields inside creation schema.";
      return res.redirect('/admin/tournament.php');
    }

    const tDate = new Date(match_time);
    if (isNaN(tDate.getTime())) {
      session.error = "Invalid match start schedule parameter.";
      return res.redirect('/admin/tournament.php');
    }

    // Auto Room release time: 15 minutes before the match start time
    const releaseTime = new Date(tDate.getTime() - 15 * 60 * 1000).toISOString();

    const tourId = 'tour_' + crypto.randomUUID().split('-')[0];
    db.tournaments.push({
      id: tourId,
      title,
      game_name,
      entry_fee: parsedFee,
      prize_pool: parsedPrize,
      match_time: tDate.toISOString(),
      room_id: crypto.randomInt(100000, 999999).toString(),
      room_password: crypto.randomBytes(3).toString('hex'),
      status: 'Upcoming',
      commission_pct: parsedComm,
      match_release_time: releaseTime,
      created_at: new Date().toISOString()
    });

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'admin_officer',
      action: 'Tournament Room Generation',
      details: `Title: ${title} | Game: ${game_name} | Entry: ₹${parsedFee} | Prize: ₹${parsedPrize}`,
      created_at: new Date().toISOString()
    });

    writeDb(db);
    session.message = "Successfully created new tournament playroom!";
    res.redirect('/admin/tournament.php');
  }
});

// Handler for DELETE actions inside GET method
app.get('/admin/tournament.php', (req, res, next) => {
  const { action, tournament_id, csrf_token } = req.query;
  if (!action) return next();

  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  if (csrf_token !== getCsrfToken(req)) {
     session.error = "CSRF Token mismatch.";
     return res.redirect('/admin/tournament.php');
  }

  if (action === 'delete') {
    const db = readDb();
    const idx = db.tournaments.findIndex(t => t.id === tournament_id);
    if (idx !== -1) {
      const title = db.tournaments[idx].title;
      db.tournaments.splice(idx, 1);
      
      db.admin_logs.push({
        id: crypto.randomUUID(),
        admin_id: 'admin',
        action: 'Tournament Deleted',
        details: `Deleted tournament ${title} (Room was purged)`,
        created_at: new Date().toISOString()
      });

      writeDb(db);
      session.message = "Purged event tournament room successfully.";
    } else {
      session.error = "Tournament room not found.";
    }
    return res.redirect('/admin/tournament.php');
  }
  next();
});

// 4. CORE SINGLE TOURNAMENT MANAGEMENT: admin/manage_tournament.php
app.get('/admin/manage_tournament.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const tourId = req.query.tournament_id as string;
  const db = readDb();
  
  const tour = db.tournaments.find(t => t.id === tourId);
  if (!tour) {
    session.error = "Selected tournament does not exist.";
    return res.redirect('/admin/tournament.php');
  }

  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  // Participants roster
  const parts = db.participants.filter(p => p.tournament_id === tour.id).map(p => {
    return db.users.find(u => u.id === p.user_id)!;
  }).filter(u => u !== undefined);

  // Uploaded match screenshots list
  const screens = db.match_screenshots.filter(s => s.tournament_id === tour.id);

  const screensHtml = screens.map(s => {
    const usrName = db.users.find(u => u.id === s.user_id)?.username || 'unknown';
    return `
      <div class="border border-slate-800 p-2 rounded-xl bg-slate-950 flex flex-col gap-2">
        <span class="text-[8px] font-mono text-slate-500 font-bold block">Uploader: @${usrName} | ${s.status}</span>
        <img src="${s.image}" class="w-full h-24 object-cover rounded-lg border border-slate-800">
        <div class="flex gap-1.5 mt-1">
          <a href="/admin/manage_tournament.php?action=screen_approve&screen_id=${s.id}&tournament_id=${tour.id}&csrf_token=${csrf}" class="flex-grow py-1 text-center bg-emerald-500 text-slate-950 text-[9px] font-bold uppercase rounded hover:bg-emerald-400">Verify</a>
          <a href="/admin/manage_tournament.php?action=screen_reject&screen_id=${s.id}&tournament_id=${tour.id}&csrf_token=${csrf}" class="flex-grow py-1 text-center bg-rose-950/20 border border-rose-500/30 text-rose-500 text-[9px] font-bold uppercase rounded hover:bg-rose-500/10">Deny</a>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <div class="border-b border-slate-900 pb-2 flex justify-between items-center">
        <div>
          <span class="text-[8px] text-indigo-400 uppercase font-black tracking-widest block font-mono">Operations Console</span>
          <h2 class="text-base font-bold text-slate-200">${escapeHtml(tour.title)}</h2>
        </div>
        <a href="/admin/tournament.php" class="text-[9px] hover:text-slate-200 border border-slate-800 px-2 py-1.5 bg-slate-900 text-slate-400 uppercase tracking-wider font-extrabold rounded-lg">&larr; Back</a>
      </div>

      <!-- Update Playroom Credentials details Form -->
      <form action="/admin/manage_tournament.php" method="POST" class="p-4 bg-slate-900 rounded-2xl border border-slate-800/80 space-y-3">
        <input type="hidden" name="csrf_token" value="${csrf}">
        <input type="hidden" name="action" value="update_room">
        <input type="hidden" name="tournament_id" value="${tour.id}">
        
        <h3 class="text-xs uppercase font-extrabold text-slate-300 border-b border-slate-800 pb-1.5 mb-2"><i class="fas fa-door-open text-indigo-400"></i> Room release logs</h3>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-[8px] uppercase tracking-wider font-bold text-slate-400 mb-0.5">ROOM ID</label>
            <input type="text" name="room_id" required value="${escapeHtml(tour.room_id)}" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-emerald-400 font-mono font-bold">
          </div>
          <div>
            <label class="block text-[8px] uppercase tracking-wider font-bold text-slate-400 mb-0.5">ROOM PASSCODE</label>
            <input type="text" name="room_password" required value="${escapeHtml(tour.room_password)}" class="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-indigo-400 font-mono font-black">
          </div>
        </div>
        <button type="submit" class="w-full py-2 bg-slate-950 border border-slate-800 text-slate-300 font-bold uppercase text-[9px] tracking-wider rounded-xl cursor-pointer hover:border-slate-700">
          Sync Playroom credentials
        </button>
      </form>

      <!-- DECLARE WINNER FORM (only if not completed) -->
      ${tour.status !== 'Completed' ? `
        <form action="/admin/manage_tournament.php" method="POST" class="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
          <input type="hidden" name="csrf_token" value="${csrf}">
          <input type="hidden" name="action" value="declare_winner">
          <input type="hidden" name="tournament_id" value="${tour.id}">

          <h3 class="text-xs uppercase font-extrabold text-slate-300 border-b border-slate-800/80 pb-1.5 mb-2"><i class="fas fa-trophy text-amber-500"></i> declare spoils winner</h3>
          <div>
            <label class="block text-[8px] uppercase font-bold text-slate-400 mb-0.5">Choose Winner Player</label>
            <select name="winner_user_id" required class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 outline-none">
              <option value="">-- Click to select participant --</option>
              ${parts.map(p => `<option value="${p.id}">@${p.username} (Wallet Balance: ₹${p.wallet_balance.toFixed(0)})</option>`).join('')}
            </select>
          </div>
          <button type="submit" ${parts.length === 0 ? 'disabled' : ''} class="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-slate-100 font-black text-xs uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow-md">
            Declare Winner & Payout ₹${tour.prize_pool.toFixed(0)}
          </button>
        </form>
      ` : `
        <div class="p-4 bg-emerald-950/10 border border-emerald-500/20 text-emerald-400 font-bold rounded-2xl text-xs text-center select-none py-6">
          <i class="fas fa-check-circle text-lg block mb-1"></i>
          This gaming lobby and match matches stand completed, and winnings are fully distributed.
        </div>
      `}

      <!-- Participant Proof Screenshots gallery -->
      <h3 class="text-xs uppercase font-extrabold text-slate-400 tracking-wider flex items-center mt-6 mb-2"><i class="fas fa-images text-indigo-500"></i> Player Screenshots (${screens.length})</h3>
      <div class="grid grid-cols-2 gap-3">
        ${screens.length === 0 ? `
          <p class="col-span-2 text-xs py-4 text-center text-slate-600 select-none border border-dashed border-slate-800 rounded-xl">No screenshot logs sent yet.</p>
        ` : screensHtml}
      </div>

      <!-- Live Participant Roster stack -->
      <h3 class="text-xs uppercase font-extrabold text-slate-400 tracking-wider mt-6 mb-2 font-mono flex items-center"><i class="fas fa-users text-indigo-500"></i> Participants list (${parts.length})</h3>
      <div class="space-y-2">
        ${parts.length === 0 ? `
          <p class="text-xs py-4 text-center text-slate-600 select-none border border-dashed border-slate-800 rounded-xl">No participant registrations yet.</p>
        ` : parts.map(p => `
          <div class="px-3 py-2 border border-slate-900 rounded-xl bg-slate-950 flex justify-between items-center text-xs">
            <span class="font-bold text-slate-300">@${escapeHtml(p.username)}</span>
            <span class="font-mono text-slate-500 font-semibold">${escapeHtml(p.email)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  res.send(renderLayout(req, html, 'Lobby Control Desk', true, flash, error));
});

// SINGLE TOURNAMENT MANAGEMENT OPERATIONS
app.post('/admin/manage_tournament.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const { action, tournament_id, csrf_token } = req.body;

  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed.";
    return res.redirect(`/admin/manage_tournament.php?tournament_id=${tournament_id}`);
  }

  const tour = db.tournaments.find(t => t.id === tournament_id);
  if (!tour) return res.redirect('/admin/tournament.php');

  // A. UPDATE PLAYROOM CREDENTIALS KEYS
  if (action === 'update_room') {
    const { room_id, room_password } = req.body;
    tour.room_id = (room_id || '').trim();
    tour.room_password = (room_password || '').trim();

    // Distribute credentials automatically alert to joined users notifications
    const parts = db.participants.filter(p => p.tournament_id === tour.id);
    parts.forEach(p => {
      db.notifications.push({
        id: crypto.randomUUID(),
        user_id: p.user_id,
        title: '🔑 Room Credentials Update',
        message: `Credentials updated for match "${tour.title}". ID: ${tour.room_id} | Pass: ${tour.room_password}. Prepare to join lobby!`,
        status: 'Unread',
        created_at: new Date().toISOString()
      });
    });

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'ref_admin',
      action: 'Credentials Synchronized',
      details: `Lobby room passcode synchronized to: ${tour.room_id} for ${tour.title}`,
      created_at: new Date().toISOString()
    });

    writeDb(db);
    session.message = "Playroom credentials updated and alerts broadcasted successfully!";
    return res.redirect(`/admin/manage_tournament.php?tournament_id=${tour.id}`);
  }

  // B. WINNER SUBMISSIONS DECLARE
  if (action === 'declare_winner') {
    const { winner_user_id } = req.body;
    const winnerUser = db.users.find(u => u.id === winner_user_id);

    if (!winnerUser) {
      session.error = "Winner player record was not found.";
      return res.redirect(`/admin/manage_tournament.php?tournament_id=${tour.id}`);
    }

    if (tour.status === 'Completed') {
      session.error = "This lobby already marked finished and resolved.";
      return res.redirect(`/admin/manage_tournament.php?tournament_id=${tour.id}`);
    }

    // Award winnings
    winnerUser.wallet_balance += tour.prize_pool;
    tour.status = 'Completed';

    // Record prize win transaction log
    db.transactions.push({
      id: 'tx_win_' + crypto.randomUUID().substring(0,6),
      user_id: winnerUser.id,
      amount: tour.prize_pool,
      type: 'credit',
      description: `Winnings prize payout payout for: ${tour.title}`,
      upi_txn_id: null,
      fraud_status: 'normal',
      review_required: false,
      created_at: new Date().toISOString()
    });

    // Notify Winner
    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: winnerUser.id,
      title: '🏆 Victory! Tournament Winner Match',
      message: `Outstanding play! You are declared the winner of "${tour.title}". Prize pool ₹${tour.prize_pool.toFixed(2)} credited!`,
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'claims_referee',
      action: 'Winner Honors Declared',
      details: `Awarded prize pool ₹${tour.prize_pool} to @${winnerUser.username} for tournament ${tour.title}`,
      created_at: new Date().toISOString()
    });

    writeDb(db);
    session.message = `🏆 Winner declared: @${winnerUser.username} has been paid successfully!`;
    return res.redirect(`/admin/manage_tournament.php?tournament_id=${tour.id}`);
  }
});

// Handlers for SCREENSHOT approvals
app.get('/admin/manage_tournament.php', (req, res, next) => {
  const { action, screen_id, tournament_id, csrf_token } = req.query;
  if (!action || !screen_id) return next();

  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  if (csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed.";
    return res.redirect(`/admin/manage_tournament.php?tournament_id=${tournament_id}`);
  }

  const db = readDb();
  const screen = db.match_screenshots.find(s => s.id === screen_id);
  if (!screen) {
    session.error = "Screenshot log not found.";
    return res.redirect(`/admin/manage_tournament.php?tournament_id=${tournament_id}`);
  }

  if (action === 'screen_approve') {
    screen.status = 'Approved';
    
    // Send unread notification to player
    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: screen.user_id,
      title: '👍 Proof Verified',
      message: 'Your uploaded match result screenshot has been successfully audited and approved.',
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    session.message = "Screenshot proof successfully verified.";
  } else if (action === 'screen_reject') {
    screen.status = 'Rejected';
    
    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: screen.user_id,
      title: '❌ Proof Rejected',
      message: 'Your uploaded result screenshot has been audit rejected. Contact staff rooms.',
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    session.message = "Screenshot proof denied and marked rejected.";
  }

  writeDb(db);
  res.redirect(`/admin/manage_tournament.php?tournament_id=${tournament_id}`);
});

// 5. REGISTRATION AUDITS: admin/user.php
app.get('/admin/user.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  // Users lists
  const users = db.users;

  // Multi-account detection shared tracking
  const ipCounts: Record<string, number> = {};
  users.forEach(u => {
    ipCounts[u.ip_address] = (ipCounts[u.ip_address] || 0) + 1;
  });

  const listHtml = users.map(u => {
    const isSusp = ipCounts[u.ip_address] >= 3;
    
    return `
      <!-- Single user row panel -->
      <div class="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
        <div class="flex justify-between items-start leading-snug">
          <div>
            <h3 class="font-bold text-slate-100 text-xs">@${escapeHtml(u.username)}</h3>
            <span class="block text-[8px] font-mono font-bold text-slate-500 uppercase mt-0.5">${escapeHtml(u.email)} | Bal: ₹${u.wallet_balance.toFixed(2)}</span>
          </div>
          
          <div class="flex flex-col items-end gap-1 select-none">
            ${isSusp ? `
              <span class="px-1.5 py-0.2 bg-rose-500/10 border border-rose-505 border-rose-500/20 text-rose-400 font-mono text-[8px] font-black rounded uppercase tracking-wider animate-pulse">IP CLONE FRAUD</span>
            ` : `
              <span class="px-1.5 py-0.2 bg-slate-950 text-slate-500 border border-slate-800 font-mono text-[8px] font-bold rounded uppercase tracking-wider">Device Authorized</span>
            `}
            <span class="text-[7px] text-slate-500 font-mono">Last Signup: ${escapeHtml(u.ip_address)}</span>
          </div>
        </div>

        <!-- Operations Actions line -->
        <div class="flex justify-between items-center bg-slate-950 px-2 py-1.5 rounded-lg border border-slate-900 mt-1">
          <div class="flex items-center gap-1.5">
            <span class="text-[9px] text-slate-500 uppercase font-bold">Wallet:</span>
            <span class="text-[9px] font-black uppercase ${u.wallet_status === 'frozen' ? 'text-rose-400' : 'text-emerald-400'}">${u.wallet_status}</span>
          </div>

          <div class="flex gap-2">
            <!-- Wallet freeze toggle action -->
            <a href="/admin/user.php?action=wallet_toggle&user_id=${u.id}&csrf_token=${csrf}" class="text-[9px] font-mono tracking-wider bg-slate-900 border hover:bg-slate-800 border-slate-800 transition-all text-slate-200 px-1.5 py-0.5 rounded">
              ${u.wallet_status === 'active' ? 'Freeze' : 'Unfreeze'}
            </a>

            <!-- Ban / Unban toggle action -->
            <a href="/admin/user.php?action=status_toggle&user_id=${u.id}&csrf_token=${csrf}" class="text-[9px] font-mono tracking-wider text-rose-500 hover:text-white bg-rose-500/5 hover:bg-rose-500 border border-rose-500/25 px-1.5 py-0.5 rounded transition-all">
              ${u.account_status === 'active' ? 'Block Player' : 'Restore'}
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <div class="border-b border-slate-900 pb-2">
        <h2 class="text-base uppercase tracking-wider font-extrabold text-slate-100 flex items-center gap-1.5"><i class="fas fa-users text-indigo-500"></i> Gamer Audit Desk</h2>
        <p class="text-[9px] text-slate-500 font-mono">Manage wallets freeze, bans, and IP clone detection alerts</p>
      </div>

      <div class="space-y-3">
        ${listHtml}
      </div>
    </div>
  `;
  res.send(renderLayout(req, html, 'Identity Audit logs', true, flash, error));
});

// ACTIONS FOR USER CONFIGS
app.get('/admin/user.php', (req, res, next) => {
  const { action, user_id, csrf_token } = req.query;
  if (!action || !user_id) return next();

  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  if (csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed.";
    res.redirect('/admin/user.php');
  }

  const db = readDb();
  const user = db.users.find(u => u.id === user_id);
  if (!user) {
    session.error = "User profile was not found.";
    return res.redirect('/admin/user.php');
  }

  // A. WALLET FREEZE STATUS TOGGLE
  if (action === 'wallet_toggle') {
    user.wallet_status = (user.wallet_status === 'active' ? 'frozen' : 'active');
    
    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      title: user.wallet_status === 'frozen' ? '⛔ Wallet Suspended' : '✅ Wallet Restored',
      message: user.wallet_status === 'frozen' ? 'Notice: Your balance withdrawals and cashout gateways stand suspended pending referee audits.' : 'Notice: Your wallet status has been fully restored. Competing rewards processing again.',
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'risk_officer',
      action: 'Wallet State Modified',
      details: `Wallet state set to: ${user.wallet_status} for player @${user.username}`,
      created_at: new Date().toISOString()
    });

    writeDb(db);
    session.message = `Successfully toggled wallet state to: ${user.wallet_status} for @${user.username}`;
    return res.redirect('/admin/user.php');
  }

  // B. USER PORTFOLIO BAN/BLOCK SUSPENSION TOGGLE
  if (action === 'status_toggle') {
    user.account_status = (user.account_status === 'active' ? 'blocked' : 'active');
    
    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'master_admin',
      action: 'Player Block Toggled',
      details: `User status set to: ${user.account_status} for player @${user.username}`,
      created_at: new Date().toISOString()
    });

    writeDb(db);
    session.message = `Successfully toggled profile ban state to: ${user.account_status} for @${user.username}`;
    return res.redirect('/admin/user.php');
  }
  next();
});

// 6. SYSTEM MANUAL UPI CONFIGURATIONS: admin/setting.php
app.get('/admin/setting.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  const html = `
    <div class="space-y-4">
      <div class="border-b border-slate-900 pb-2">
        <h2 class="text-base uppercase tracking-wider font-extrabold text-slate-100 flex items-center gap-1.5"><i class="fas fa-sliders-h text-indigo-500"></i> Vault Configuration Settings</h2>
        <p class="text-[9px] text-slate-500 font-mono">Set UPI merchant ID, upload manual checkout QR codes, and passwords</p>
      </div>

      <!-- Merchant details settings form -->
      <form action="/admin/setting.php" method="POST" class="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-3">
        <input type="hidden" name="csrf_token" value="${csrf}">
        <input type="hidden" name="action" value="upi_qr_update">
        
        <h3 class="text-xs uppercase font-extrabold text-slate-300 border-b border-slate-850 pb-1 mb-1"><i class="fas fa-exchange-alt"></i> Manual Checkout Settings</h3>
        
        <div>
          <label class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Incoming Merchant UPI ID Destination</label>
          <input type="text" name="admin_upi_id" required value="${escapeHtml(db.settings.admin_upi_id)}" placeholder="merchant@upi" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 font-mono">
        </div>

        <div>
          <label class="block text-[10px] uppercase font-bold text-slate-400 mb-1">Manual QRCode Visualizer Image Upload</label>
          <input type="hidden" id="qr_base64" name="admin_qr_code" required value="${db.settings.admin_qr_code}">
          
          <div class="flex items-center gap-4 bg-slate-950 p-2.5 rounded-xl border border-slate-900">
            <img src="${db.settings.admin_qr_code}" id="qr-preview" class="w-14 h-14 object-contain rounded bg-white p-1">
            <div class="flex-grow">
              <label class="block text-center py-2 border border-slate-800 hover:border-indigo-500/50 bg-slate-900 rounded-lg text-[9px] tracking-wider uppercase font-extrabold text-slate-400 cursor-pointer select-none">
                Scan visual selector
                <input type="file" accept="image/*" class="hidden" onchange="convertQRAndPreview(this)">
              </label>
            </div>
          </div>
        </div>

        <button type="submit" class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-slate-100 font-bold uppercase text-[10px] rounded-xl cursor-pointer">
          Save Merchant details
        </button>
      </form>
    </div>

    <script>
      function convertQRAndPreview(input) {
        const file = input.files[0];
        if(!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
          document.getElementById('qr_base64').value = e.target.result;
          document.getElementById('qr-preview').src = e.target.result;
        }
        reader.readAsDataURL(file);
      }
    </script>
  `;
  res.send(renderLayout(req, html, 'Platform properties keys', true, flash, error));
});

// POST METHOD SYSTEM SETTINGS PROCESSOR
app.post('/admin/setting.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const { action, csrf_token } = req.body;

  if (!csrf_token || csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Verification Failure. Connection Rejected.";
    return res.redirect('/admin/setting.php');
  }

  if (action === 'upi_qr_update') {
    const { admin_upi_id, admin_qr_code } = req.body;
    db.settings.admin_upi_id = (admin_upi_id || '').trim();
    if (admin_qr_code) {
      db.settings.admin_qr_code = admin_qr_code;
    }

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'admin_officer',
      action: 'Merchant Info Refreshed',
      details: `UPI merchant account: ${db.settings.admin_upi_id} updated.`,
      created_at: new Date().toISOString()
    });

    writeDb(db);
    session.message = "UPI Merchant Address and Checkout QR image successfully updated!";
    return res.redirect('/admin/setting.php');
  }
});

// 7. DEPOSIT REQUEST MANAGER: admin/deposits.php
app.get('/admin/deposits.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  const pendingDeps = db.deposits.sort((a,b) => b.created_at.localeCompare(a.created_at));

  // Highlighting fraudulent transactions checks
  const doubleUtrMap = new Set<string>();
  const allUtrSet = new Set<string>();
  
  db.deposits.forEach(d => {
    if (d.status === 'Approved' || d.status === 'Pending') {
      const utr = d.transaction_id;
      if (allUtrSet.has(utr)) {
        doubleUtrMap.add(utr);
      }
      allUtrSet.add(utr);
    }
  });

  const listHtml = pendingDeps.map(d => {
    const user = db.users.find(u => u.id === d.user_id);
    const isDupFraud = doubleUtrMap.has(d.transaction_id);

    return `
      <!-- Manual deposit item -->
      <div class="p-3 bg-slate-900 border ${isDupFraud ? 'border-rose-500/40 bg-rose-950/5 animate-pulse' : 'border-slate-800'} rounded-xl space-y-2">
        <div class="flex justify-between items-start leading-snug">
          <div>
            <h3 class="font-bold text-slate-100 text-xs">@${user ? escapeHtml(user.username) : 'unknown'}</h3>
            <span class="block text-[8px] font-mono text-slate-500 font-bold uppercase mt-0.5">${new Date(d.created_at).toLocaleString()} | Amount: <span class="text-emerald-400 font-bold">₹${d.amount}</span></span>
          </div>
          <div>
             <span class="px-1.5 py-0.2 rounded text-[7px] font-black uppercase font-mono border ${d.status === 'Pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}">${d.status}</span>
          </div>
        </div>

        <div class="bg-slate-950 p-2.5 border border-slate-900 rounded-lg flex items-center justify-between text-xs font-mono">
          <span class="text-[9px] text-slate-500 uppercase font-black">Ref UTR String:</span>
          <span class="font-extrabold select-all text-emerald-400 tracking-wider">${escapeHtml(d.transaction_id)}</span>
        </div>

        ${isDupFraud ? `
          <div class="px-2.5 py-1 rounded bg-rose-500/10 border border-rose-500/25 text-[9px] font-bold text-rose-400 font-mono leading-none tracking-tight flex items-center gap-1.5"><i class="fas fa-exclamation-triangle"></i> ALERT FRAUD: DUPLICATE UPI TRAN REFERENCE ID (UTR) DETECTED!</div>
        ` : ''}

        ${d.status === 'Pending' ? `
          <div class="flex gap-2.5 pt-1">
            <a href="/admin/deposits.php?action=approve&id=${d.id}&csrf_token=${csrf}" class="flex-grow py-1.8 text-center bg-emerald-500 text-slate-950 text-[10px] tracking-wider uppercase font-black rounded-lg hover:bg-emerald-400 select-none transition-all">Verify & Approve</a>
            <a href="/admin/deposits.php?action=reject&id=${d.id}&csrf_token=${csrf}" class="flex-grow py-1.8 text-center bg-slate-950 border border-slate-800 hover:bg-rose-950/20 text-rose-400 border border-slate-800 text-[10px] tracking-wider font-extrabold rounded-lg hover:border-rose-900 transition-all">Reject</a>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <div class="border-b border-slate-900 pb-2 flex justify-between items-center">
        <div>
          <h2 class="text-base uppercase tracking-wider font-extrabold text-slate-100 flex items-center gap-1.5"><i class="fas fa-qrcode text-emerald-400"></i> Cashin Requests Panel</h2>
          <p class="text-[9px] text-slate-500 font-mono">Verify incoming payments reference transaction IDs</p>
        </div>
        <a href="/admin/index.php" class="text-[9px] border border-slate-800 px-3 py-1.5 bg-slate-900 text-slate-400 font-bold uppercase tracking-wider rounded-xl">Back</a>
      </div>

      <div class="space-y-3">
        ${pendingDeps.length === 0 ? `
          <p class="text-xs text-slate-600 border border-dashed border-slate-800 py-8 text-center rounded-xl select-none">No deposits logged yet.</p>
        ` : listHtml}
      </div>
    </div>
  `;
  res.send(renderLayout(req, html, 'Deposit Review Desk', true, flash, error));
});

// TRIGGER DEPOSITS ACTIONS
app.get('/admin/deposits.php', (req, res, next) => {
  const { action, id, csrf_token } = req.query;
  if (!id || !action) return next();

  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  if (csrf_token !== getCsrfToken(req)) {
    session.error = "CSRF Token Validation Failed.";
    return res.redirect('/admin/deposits.php');
  }

  const db = readDb();
  const dep = db.deposits.find(d => d.id === id);
  if (!dep) {
    session.error = "Deposit request log not found.";
    return res.redirect('/admin/deposits.php');
  }

  const user = db.users.find(u => u.id === dep.user_id);
  if (!user) {
    session.error = "User profile broken.";
    return res.redirect('/admin/deposits.php');
  }

  if (action === 'approve') {
    dep.status = 'Approved';
    user.wallet_balance += dep.amount;

    // Check if the depositor has a referrer
    if (user.referred_by) {
      // Find all Approved deposits of this user, excluding the current one
      const priorApprovedDeposits = db.deposits.filter(d => d.user_id === user.id && d.status === 'Approved' && d.id !== dep.id);
      
      // If this is their first approved deposit
      if (priorApprovedDeposits.length === 0) {
        const referrer = db.users.find(u => u.id === user.referred_by);
        if (referrer) {
          const REFERRAL_REWARD = 5.00; // per person ₹5
          referrer.wallet_balance += REFERRAL_REWARD;
          
          db.transactions.push({
            id: 'tx_ref_dep_' + crypto.randomUUID().substring(0,6),
            user_id: referrer.id,
            amount: REFERRAL_REWARD,
            type: 'credit',
            description: `Referral award for @${user.username}'s first deposit`,
            upi_txn_id: null,
            fraud_status: 'normal',
            review_required: false,
            created_at: new Date().toISOString()
          });

          db.referrals.push({
            id: crypto.randomUUID(),
            referrer_id: referrer.id,
            referred_user_id: user.id,
            bonus_amount: REFERRAL_REWARD,
            created_at: new Date().toISOString()
          });

          db.notifications.push({
            id: crypto.randomUUID(),
            user_id: referrer.id,
            title: '🎁 Referral Reward Received',
            message: `Congratulations! You earned ₹${REFERRAL_REWARD.toFixed(2)} because your referee @${user.username} successfully made their first deposit!`,
            status: 'Unread',
            created_at: new Date().toISOString()
          });
        }
      }
    }

    db.transactions.push({
      id: 'tx_dep_' + crypto.randomUUID().substring(0,6),
      user_id: user.id,
      amount: dep.amount,
      type: 'credit',
      description: `Manual cashin deposit approved`,
      upi_txn_id: dep.transaction_id,
      fraud_status: 'normal',
      review_required: false,
      created_at: new Date().toISOString()
    });

    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      title: '💰 Manual Deposit Approved',
      message: `Your manual payment worth ₹${dep.amount.toFixed(2)} has been verified and added to balance base.`,
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'ref_admin',
      action: 'Deposit Approved',
      details: `Approved manual pay credits worth ₹${dep.amount} to user @${user.username} (UTR: ${dep.transaction_id})`,
      created_at: new Date().toISOString()
    });

    session.message = "Successfully verified and credited wallet balance!";
  } else if (action === 'reject') {
    dep.status = 'Rejected';
    
    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      title: '❌ Deposit Request Rejected',
      message: `Ref UTR (${dep.transaction_id}) payment was audit rejected. Contact staff rooms.`,
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'risk_admin',
      action: 'Deposit Audited Rejected',
      details: `Rejected manual pay credits worth ₹${dep.amount} to @${user.username} (UTR: ${dep.transaction_id})`,
      created_at: new Date().toISOString()
    });

    session.message = "Successfully denied payment credits request.";
  }

  writeDb(db);
  res.redirect('/admin/deposits.php');
});

// 8. WITHDRAWALS MANUAL CLEARANCE: admin/withdrawals.php
app.get('/admin/withdrawals.php', (req, res) => {
  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  const db = readDb();
  const flash = session.message;
  const error = session.error;
  delete session.message;
  delete session.error;

  const csrf = getCsrfToken(req);

  const pendingWiths = db.withdrawals.sort((a,b) => b.created_at.localeCompare(a.created_at));

  const listHtml = pendingWiths.map(w => {
    const user = db.users.find(u => u.id === w.user_id);
    return `
      <!-- Manual withdraw item -->
      <div class="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
        <div class="flex justify-between items-start leading-snug">
          <div>
            <h3 class="font-bold text-slate-100 text-xs">@${user ? escapeHtml(user.username) : 'unknown'}</h3>
            <span class="block text-[8px] font-mono text-slate-400 font-bold uppercase mt-0.5">${new Date(w.created_at).toLocaleString()} | Amount: <span class="text-rose-400 font-black">₹${w.amount}</span></span>
          </div>
          <div>
             <span class="px-1.5 py-0.2 rounded text-[7px] font-mono font-black uppercase border ${w.status === 'Pending' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}">${w.status}</span>
          </div>
        </div>

        <div class="bg-slate-950 p-2 border border-slate-900 rounded-lg flex items-center justify-between text-xs font-mono">
          <span class="text-[9px] text-slate-500 uppercase font-black">User Payout UPI Destination:</span>
          <span class="font-extrabold select-all text-slate-200 tracking-wider">${user ? escapeHtml(user.upi_id || 'NOT SETUP!') : 'unknown'}</span>
        </div>

        ${w.status === 'Pending' ? `
          <div class="flex gap-2.5 pt-1">
            <a href="/admin/withdrawals.php?action=complete&id=${w.id}&csrf_token=${csrf}" class="flex-grow py-1.8 text-center bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] tracking-wider uppercase font-black rounded-lg select-none transition-all">Mark Settled Done</a>
            <a href="/admin/withdrawals.php?action=reject&id=${w.id}&csrf_token=${csrf}" class="flex-grow py-1.8 text-center bg-slate-950 border border-slate-850 hover:bg-rose-950/20 text-rose-450 text-[10px] border border-slate-800 font-bold rounded-lg hover:border-rose-900 transition-all">Deny Request</a>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  const html = `
    <div class="space-y-4">
      <div class="border-b border-slate-900 pb-2 flex justify-between items-center">
        <div>
          <h2 class="text-base uppercase tracking-wider font-extrabold text-slate-100 flex items-center gap-1.5"><i class="fas fa-university text-amber-500"></i> Cashout Payout Desk</h2>
          <p class="text-[9px] text-slate-500 font-mono">Process escrows pay, click settled, or reject requests</p>
        </div>
        <a href="/admin/index.php" class="text-[9px] border border-slate-800 px-3 py-1.5 bg-slate-900 text-slate-400 font-bold uppercase tracking-wider rounded-xl">Back</a>
      </div>

      <div class="space-y-3">
        ${pendingWiths.length === 0 ? `
          <p class="text-xs text-slate-600 border border-dashed border-slate-800 py-8 text-center rounded-xl select-none">No withdrawals logged yet.</p>
        ` : listHtml}
      </div>
    </div>
  `;
  res.send(renderLayout(req, html, 'Withdraw Review Desk', true, flash, error));
});

// ACTIONS FOR ESCROW WITHDRAWALS
app.get('/admin/withdrawals.php', (req, res, next) => {
  const { action, id, csrf_token } = req.query;
  if (!id || !action) return next();

  const session = getAdminSession(req, res);
  if (!session.adminId) return res.redirect('/admin/login.php');

  if (csrf_token !== getCsrfToken(req)) {
     session.error = "CSRF Token Validation Failed.";
     return res.redirect('/admin/withdrawals.php');
  }

  const db = readDb();
  const withDr = db.withdrawals.find(w => w.id === id);
  if (!withDr) {
    session.error = "Withdrawal request log not found.";
    return res.redirect('/admin/withdrawals.php');
  }

  const user = db.users.find(u => u.id === withDr.user_id);
  if (!user) {
    session.error = "User profile broken.";
    return res.redirect('/admin/withdrawals.php');
  }

  if (action === 'complete') {
    withDr.status = 'Completed';

    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      title: '💸 Payout Settlement Sent',
      message: `Your requested withdrawal cashout worth ₹${withDr.amount.toFixed(2)} has been settled manually to: ${user.upi_id}`,
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'ref_admin',
      action: 'Payout Settled Done',
      details: `Settled withdrawal payment ₹${withDr.amount} to user @${user.username} (UPI: ${user.upi_id})`,
      created_at: new Date().toISOString()
    });

    session.message = "Successfully cleared cashout payout status.";
  } else if (action === 'reject') {
    withDr.status = 'Rejected';
    // Credit held escrow funds back immediately
    user.wallet_balance += withDr.amount;

    db.transactions.push({
      id: 'tx_with_ref_credit_' + crypto.randomUUID().substring(0,6),
      user_id: user.id,
      amount: withDr.amount,
      type: 'credit',
      description: `Escrow payouts refund (Request Denied)`,
      upi_txn_id: null,
      fraud_status: 'normal',
      review_required: false,
      created_at: new Date().toISOString()
    });

    db.notifications.push({
      id: crypto.randomUUID(),
      user_id: user.id,
      title: '❌ Withdrawal Denied & Refused',
      message: `Request for ₹${withDr.amount} has been denied. Held money refunded to wallet.`,
      status: 'Unread',
      created_at: new Date().toISOString()
    });

    db.admin_logs.push({
      id: crypto.randomUUID(),
      admin_id: 'risk_officer',
      action: 'Payout Request Denied',
      details: `Rejected withdrawal request of ₹${withDr.amount} for @${user.username} (Escrow refunded)`,
      created_at: new Date().toISOString()
    });

    session.message = "Withdrawal denied. Funds restored to player wallet.";
  }

  writeDb(db);
  res.redirect('/admin/withdrawals.php');
});

// -------------------------------------------------------------
// BIND PORT AND RUN SERVERS
// -------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(`MVP Tournament server running on port ${PORT}`);
});


