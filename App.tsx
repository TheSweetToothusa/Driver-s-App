import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Package, ChevronRight, X, Check, RefreshCw,
  LogOut, Calendar, MapPin, Phone,
  Navigation, CheckCircle2, Send,
  Eye, Camera, PenTool,
  Settings, FileText,
  UserPlus, Users,
  MessageCircle, MessageSquare, ChevronLeft, Edit3,
  Bell, Clock, XCircle, Gift, User,
  AlertTriangle, RotateCcw, Inbox, Home, DollarSign, Store, Truck, Map as MapIcon, Route, Trash2, Plus,
  ChevronUp, ChevronDown, MoreVertical, Printer, Mail
} from 'lucide-react';
import { Delivery, DeliveryStatus, AppRole, FailureReason, FAILURE_REASON_LABELS, ViewMode, UserAccount, MessageTemplate } from './types';
import { getDeliveries } from './services/shopifyService';
import { DELIVERY_FEES } from './src/constants';

const BRAND_LOGO = "https://cdn.shopify.com/s/files/1/0559/8498/0141/files/The_Sweet_Tooth_Chocolate_Factory_Logo.png?v=1759286605";

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

const isWithinSendingHours = () => { const h = new Date().getHours(); return h >= 9 && h < 20; };
const STATUSES_FOR_DROPDOWN = [
  { value: 'PENDING',            label: 'Not Assigned',       color: '#78716c' },
  { value: 'SCHEDULED',          label: 'Scheduled',          color: '#7c3aed' },
  { value: 'ASSIGNED',           label: 'Assigned',           color: '#2563eb' },
  { value: 'IN_TRANSIT',         label: 'Out for Delivery',   color: '#000000' },
  { value: 'DELIVERED',          label: 'Delivered',          color: '#16a34a' },
  { value: 'FAILED',             label: '1st Attempt Failed', color: '#dc2626' },
  { value: 'SECOND_ATTEMPT',     label: '2nd Attempt',        color: '#374151' },
  { value: 'PENDING_RESCHEDULE', label: 'Needs Reschedule',   color: '#d97706' },
  { value: 'CANCELLED',          label: 'Cancelled',          color: '#ef4444' },
  { value: 'CLOSED',             label: 'Closed',             color: '#9ca3af' },
];
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─────────────────────────────────────────────────────────────────────────────
// PRINT PREVIEW — bulletproof cross-platform print UI
//
// Renders label content in a full-screen in-app modal (no pop-ups, no new tabs,
// no hidden iframes). Calls window.print() on the main window; @media print
// CSS hides the rest of the app so only the labels print. Works identically on
// iOS Safari, iOS standalone PWA, Chrome Android, and desktop.
// ─────────────────────────────────────────────────────────────────────────────
function showPrintPreview(opts: {
  content: string;       // inner HTML (labels, cover, etc.)
  css: string;           // raw CSS rules (auto-scoped to #sweet-print-scroll via nesting)
  title: string;         // toolbar title
  pageSize?: string;     // CSS @page size, default '4in 6in'
}) {
  const { content, css, title, pageSize = '4in 6in' } = opts;

  document.getElementById('sweet-print-overlay')?.remove();
  document.getElementById('sweet-print-styles')?.remove();

  const styleEl = document.createElement('style');
  styleEl.id = 'sweet-print-styles';
  styleEl.textContent = `
    #sweet-print-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: #4b5563;
      display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    }
    #sweet-print-toolbar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
      background: #111; color: #fff;
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      flex-shrink: 0;
      padding-top: max(10px, env(safe-area-inset-top));
    }
    #sweet-print-close {
      background: transparent; color: #fff; border: 0;
      width: 44px; height: 44px; font-size: 22px;
      cursor: pointer; border-radius: 999px;
      display: flex; align-items: center; justify-content: center;
      -webkit-tap-highlight-color: transparent;
    }
    #sweet-print-close:active { background: rgba(255,255,255,0.15); }
    #sweet-print-title {
      flex: 1; font-weight: 700; font-size: 14px;
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #sweet-print-btn {
      background: #fff; color: #000; border: 0;
      padding: 11px 22px; font-size: 15px; font-weight: 900;
      border-radius: 10px; cursor: pointer;
      -webkit-appearance: none; appearance: none;
      flex-shrink: 0;
    }
    #sweet-print-btn:active { background: #ddd; }
    #sweet-print-scroll {
      flex: 1 1 auto; overflow-y: auto; overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
      padding: 16px 8px 32px;
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      background: #4b5563;
    }
    #sweet-print-scroll > * {
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      background: #fff;
      flex-shrink: 0;
    }
    #sweet-print-hint {
      background: #111; color: #d1d5db;
      font-size: 12px; text-align: center;
      padding: 10px 16px;
      padding-bottom: max(10px, env(safe-area-inset-bottom));
      line-height: 1.5; flex-shrink: 0;
    }

    /* Caller's styles — scoped via CSS nesting (Chrome 112+, Safari 16.5+, FF 117+) */
    #sweet-print-scroll {
      ${css}
    }

    /* Print: hide app, show only labels */
    @media print {
      @page { size: ${pageSize}; margin: 0; }
      body > *:not(#sweet-print-overlay) { display: none !important; }
      #sweet-print-overlay {
        position: static !important;
        background: #fff !important;
        display: block !important;
      }
      #sweet-print-toolbar, #sweet-print-hint { display: none !important; }
      #sweet-print-scroll {
        padding: 0 !important;
        gap: 0 !important;
        background: #fff !important;
        overflow: visible !important;
        display: block !important;
      }
      #sweet-print-scroll > * { box-shadow: none !important; }
    }
  `;
  document.head.appendChild(styleEl);

  const overlay = document.createElement('div');
  overlay.id = 'sweet-print-overlay';
  overlay.innerHTML = `
    <div id="sweet-print-toolbar">
      <button id="sweet-print-close" aria-label="Close preview">✕</button>
      <div id="sweet-print-title">${title}</div>
      <button id="sweet-print-btn">🖨️ Print</button>
    </div>
    <div id="sweet-print-scroll">${content}</div>
    <div id="sweet-print-hint">If Print doesn't open the print dialog, use <b>Share → Print</b> (iPhone) or <b>⋮ menu → Print</b> (Android).</div>
  `;
  document.body.appendChild(overlay);

  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  const close = () => {
    overlay.remove();
    styleEl.remove();
    document.body.style.overflow = prevBodyOverflow;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  overlay.querySelector('#sweet-print-close')!.addEventListener('click', close);
  overlay.querySelector('#sweet-print-btn')!.addEventListener('click', () => {
    window.print();
  });
}

// Status badge config
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  PENDING:             { label: 'Not Assigned',       bg: 'bg-stone-800',   text: 'text-white' },
  SCHEDULED:           { label: 'Scheduled',          bg: 'bg-violet-600',  text: 'text-white' },
  ASSIGNED:            { label: 'Assigned',           bg: 'bg-blue-600',    text: 'text-white' },
  IN_TRANSIT:          { label: 'Out for Delivery',   bg: 'bg-black',       text: 'text-white' },
  DELIVERED:           { label: 'Delivered ✓',        bg: 'bg-green-600',   text: 'text-white' },
  FAILED:              { label: '1st Attempt Failed', bg: 'bg-red-600',     text: 'text-white' },
  SECOND_ATTEMPT:      { label: '2nd Attempt',        bg: 'bg-stone-700',   text: 'text-white' },
  PENDING_RESCHEDULE:  { label: 'Needs Reschedule',   bg: 'bg-amber-500',   text: 'text-white' },
  CLOSED:              { label: 'Closed',             bg: 'bg-stone-300',   text: 'text-stone-600' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIGNATURE PAD
// ─────────────────────────────────────────────────────────────────────────────

// Tap to reveal number, then confirm to call — no pocket dials
const SMS_TEMPLATES_DATA = [
  {
    id: 'im_outside',
    label: "🚪 I'm Outside / Anyone Home?",
    build: (n: string, p: string, _a: string) =>
      `Hi! This is The Sweet Tooth 🍫 — we're a chocolate gift shop and someone sent you a special gift! Our driver is outside right now. Is anyone home to receive it? It's perishable and we can't leave it outside. Please call or text us back at ${p}. Thank you!`,
  },
  {
    id: 'no_one_home',
    label: '🔔 No Answer — Leave With Someone?',
    build: (n: string, p: string, _a: string) =>
      `Hi! This is The Sweet Tooth 🍫 — someone sent you a chocolate gift and our driver just tried to deliver it but couldn't reach you. It's perishable and we can't leave it outside. Is there a neighbor, doorman, or someone nearby who can receive it? Please call or text us at ${p} ASAP. Thank you!`,
  },
  {
    id: 'cant_find_unit',
    label: "🏢 Can't Find Your Unit",
    build: (n: string, p: string, a: string) =>
      `Hi! This is The Sweet Tooth 🍫 — someone sent you a chocolate gift and our driver is at ${a || 'your address'} but is having trouble finding your unit. Can you help guide us in? Please call or text ${p} right away. We don't want your gift to go to waste!`,
  },
  {
    id: 'gated',
    label: '🔒 Gated / Need Access',
    build: (n: string, p: string, _a: string) =>
      `Hi! This is The Sweet Tooth 🍫 — someone sent you a chocolate gift! Our driver is at your gate or building entrance and needs the access code or to be buzzed in. Please call or text us at ${p} right away so we can get your gift to you!`,
  },
  {
    id: 'wrong_address',
    label: '📍 Having Trouble Finding You',
    build: (n: string, p: string, _a: string) =>
      `Hi! This is The Sweet Tooth 🍫 — someone sent you a chocolate gift and our driver is on the way but is having trouble with the address. Can you confirm your full address or drop a pin? Please call or text us at ${p}. We want to make sure your gift gets to you!`,
  },
  {
    id: 'running_late',
    label: '🚗 Running Late',
    build: (n: string, p: string, _a: string) =>
      `Hi! This is The Sweet Tooth 🍫 — someone sent you a chocolate gift and our driver is on the way but running a bit behind due to traffic. We'll be there in about 15–20 minutes. Will someone be available to receive it? If not, please let us know the best time to come back. Call or text ${p}. Thank you!`,
  },
  {
    id: 'perishable_warning',
    label: '🌡️ Perishable — Need to Coordinate',
    build: (n: string, p: string, _a: string) =>
      `Hi! This is The Sweet Tooth 🍫 — someone sent you a chocolate gift! We've tried to reach you a couple of times. Since it's perishable, we can't leave it outside. Please call or text us at ${p} so we can arrange delivery. We'd hate for your gift to go to waste!`,
  },
];

const ContactCallReveal: React.FC<{ phone: string; label: string; showTemplates?: boolean; driverName?: string; driverPhone?: string; address?: string }> = ({ phone, label, showTemplates, driverName, driverPhone, address }) => {
  const [revealed, setRevealed] = React.useState(false);
  const [showTpl, setShowTpl] = React.useState(false);
  const [smsSent, setSmsSent] = React.useState(false);
  const [customMsg, setCustomMsg] = React.useState('');
  const [previewTpl, setPreviewTpl] = React.useState<string | null>(null);
  const clean = phone.replace(/\D/g, '');
  const dn = driverName || 'your driver';
  const dp = driverPhone || '';
  const addr = address || 'your address';

  const handleTemplateTap = () => {
    setSmsSent(true);
    setTimeout(() => setSmsSent(false), 2500);
  };

  if (!revealed) {
    return (
      <button onClick={() => setRevealed(true)}
        className="flex items-center justify-center gap-2 w-full py-3 bg-stone-100 text-stone-700 rounded-xl font-black uppercase text-xs active:bg-stone-200">
        <Phone size={14} /> Show Number — {label}
      </button>
    );
  }
  return (
    <div className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 space-y-2">
      <span className="block font-black text-stone-900 text-sm tracking-widest">{phone}</span>
      <div className="flex items-center gap-2">
        {showTemplates && dp ? (
          <button onClick={() => setShowTpl(s => !s)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-500 text-white rounded-lg font-black uppercase text-xs active:bg-green-600">
            💬 Text {showTpl ? '▲' : '▼'}
          </button>
        ) : (
          <a href={`sms:${clean}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-500 text-white rounded-lg font-black uppercase text-xs active:bg-green-600">
            💬 Text
          </a>
        )}
        <a href={`tel:${clean}`}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-black text-white rounded-lg font-black uppercase text-xs active:bg-stone-800">
          <Phone size={13} /> Call
        </a>
        <button onClick={() => { setRevealed(false); setShowTpl(false); setPreviewTpl(null); }}
          className="px-3 py-2.5 bg-stone-200 text-stone-600 rounded-lg font-black uppercase text-xs active:bg-stone-300">
          Hide
        </button>
      </div>

      {/* SMS sent toast */}
      {smsSent && (
        <div className="flex items-center justify-center gap-2 bg-green-500 text-white rounded-xl px-3 py-2.5">
          <CheckCircle2 size={16} />
          <span className="text-sm font-black">✅ Message is pre-written — just hit Send!</span>
        </div>
      )}

      {showTpl && (
        <div className="space-y-1.5 pt-1">
          {!previewTpl ? (
            <>
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Tap to preview before sending:</p>
              {SMS_TEMPLATES_DATA.map(t => (
                <button
                  key={t.id}
                  onClick={() => setPreviewTpl(t.id)}
                  className="flex items-center justify-between w-full bg-white border border-stone-200 rounded-lg px-3 py-2.5 active:bg-stone-50 text-left">
                  <span className="text-xs font-bold text-stone-800">{t.label}</span>
                  <ChevronRight size={13} className="text-stone-400" />
                </button>
              ))}
              {/* Custom message */}
              <div className="bg-white border border-stone-200 rounded-lg px-3 py-2.5 space-y-2">
                <p className="text-xs font-bold text-stone-800">✏️ Write your own</p>
                <textarea
                  value={customMsg}
                  onChange={e => setCustomMsg(e.target.value)}
                  placeholder="Type your message here..."
                  rows={3}
                  className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black resize-none"
                />
                {customMsg.trim() && (
                  <button
                    onClick={() => setPreviewTpl('__custom__')}
                    className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-black uppercase text-xs bg-stone-800 text-white active:bg-black">
                    Preview Before Sending
                  </button>
                )}
              </div>
            </>
          ) : (
            /* ── PREVIEW SCREEN ── */
            <div className="bg-white border-2 border-green-400 rounded-xl overflow-hidden">
              <div className="bg-green-500 px-3 py-2 flex items-center justify-between">
                <span className="text-white text-xs font-black uppercase tracking-widest">📋 Message Preview</span>
                <button onClick={() => setPreviewTpl(null)} className="text-white/80 text-xs font-black">← Back</button>
              </div>
              {/* iPhone-style bubble */}
              <div className="px-4 py-4 bg-stone-50">
                <div className="bg-green-500 rounded-2xl rounded-br-sm px-4 py-3 max-w-[90%] ml-auto">
                  <p className="text-white text-sm leading-relaxed">
                    {previewTpl === '__custom__'
                      ? customMsg
                      : SMS_TEMPLATES_DATA.find(t => t.id === previewTpl)?.build(dn, dp, addr)}
                  </p>
                </div>
                <p className="text-[10px] text-stone-400 text-right mt-1">To: {phone}</p>
              </div>
              <div className="px-3 pb-3 space-y-2">
                <a
                  href={`sms:${clean}?body=${encodeURIComponent(
                    previewTpl === '__custom__'
                      ? customMsg
                      : SMS_TEMPLATES_DATA.find(t => t.id === previewTpl)?.build(dn, dp, addr) || ''
                  )}`}
                  onClick={handleTemplateTap}
                  className="flex items-center justify-center gap-2 w-full py-3.5 bg-green-500 text-white rounded-xl font-black uppercase text-sm active:bg-green-600">
                  ✅ Looks Good — Send It
                </a>
                <button
                  onClick={() => setPreviewTpl(null)}
                  className="flex items-center justify-center w-full py-2.5 bg-stone-100 text-stone-600 rounded-xl font-black uppercase text-xs active:bg-stone-200">
                  ← Choose Different Message
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SignaturePad: React.FC<{ onSave: (d: string) => void; onCancel: () => void }> = ({ onSave, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Size canvas to actual display pixels (fixes blank signature bug)
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const pos = (e: MouseEvent | TouchEvent) => {
      const r = canvas.getBoundingClientRect();
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
      return { x: (cx - r.left), y: (cy - r.top) };
    };
    const start = (e: MouseEvent | TouchEvent) => { isDrawing.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
    const move = (e: MouseEvent | TouchEvent) => { if (!isDrawing.current) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
    const stop = () => { isDrawing.current = false; };
    canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);
    canvas.addEventListener('touchstart', start, { passive: false }); canvas.addEventListener('touchmove', move, { passive: false }); canvas.addEventListener('touchend', stop);
    return () => {
      canvas.removeEventListener('mousedown', start); canvas.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop);
      canvas.removeEventListener('touchstart', start); canvas.removeEventListener('touchmove', move); canvas.removeEventListener('touchend', stop);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/90 z-[300] flex flex-col p-6">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-white font-black uppercase text-xs tracking-widest">Recipient Signature</h3>
        <button onClick={onCancel} className="text-white/50"><X size={22} /></button>
      </div>
      <p className="text-white/40 text-xs mb-4">Have recipient sign below</p>
      <div ref={containerRef} className="flex-1 bg-white rounded-3xl overflow-hidden border-4 border-white">
        <canvas ref={canvasRef} className="touch-none" />
      </div>
      <div className="mt-4 flex gap-3">
        <button onClick={() => {
          const c = canvasRef.current;
          if (!c) return;
          const ctx = c.getContext('2d');
          if (ctx) { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,c.width,c.height); const dpr = window.devicePixelRatio||1; ctx.scale(dpr,dpr); ctx.strokeStyle='#000'; ctx.lineWidth=3; ctx.lineCap='round'; ctx.lineJoin='round'; }
        }} className="flex-1 py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px]">Clear</button>
        <button onClick={onCancel} className="flex-1 py-5 bg-white/20 text-white rounded-2xl font-black uppercase text-[10px]">Skip</button>
        <button onClick={() => canvasRef.current && onSave(canvasRef.current.toDataURL())} className="flex-2 py-5 bg-white text-black rounded-2xl font-black uppercase text-[10px] px-6">Save Signature</button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN GATE
// ─────────────────────────────────────────────────────────────────────────────

const LoginGate: React.FC<{ onAuthorized: (user: UserAccount) => void }> = ({ onAuthorized }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (value: string) => {
    if (value.length !== 4) return;
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: value })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Incorrect PIN');
        setPin('');
        setShake(true);
        setTimeout(() => setShake(false), 500);
      } else {
        onAuthorized(data.user);
      }
    } catch { setError('Connection error. Try again.'); setPin(''); }
    finally { setLoading(false); }
  };

  const handleDigit = (d: string) => {
    if (loading) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    setError('');
    if (next.length === 4) submit(next);
  };

  const handleDelete = () => { setPin(p => p.slice(0, -1)); setError(''); };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 select-none">
      <img src={BRAND_LOGO} className="h-36 mb-10 object-contain" alt="Logo" />

      <p className="text-[11px] font-black uppercase tracking-widest text-stone-400 mb-8">Enter your PIN</p>

      {/* Dot indicators */}
      <div className={`flex gap-5 mb-10 ${shake ? 'animate-bounce' : ''}`}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`w-4 h-4 rounded-full transition-all duration-150 ${i < pin.length ? 'bg-black scale-110' : 'bg-stone-200'}`} />
        ))}
      </div>

      {error && <p className="text-xs font-black text-red-500 mb-6 text-center">{error}</p>}

      {/* Keypad */}
      <div className="grid grid-cols-3 gap-4 w-72">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, i) => {
          if (key === '') return <div key={i} />;
          return (
            <button key={i}
              onClick={() => key === '⌫' ? handleDelete() : handleDigit(key)}
              disabled={loading}
              className={`h-20 rounded-[22px] font-black text-2xl flex items-center justify-center active:scale-95 transition-all
                ${key === '⌫' ? 'bg-stone-100 text-stone-500 text-xl' : 'bg-stone-100 text-stone-900 hover:bg-stone-200'}
                ${loading ? 'opacity-40' : ''}
              `}
            >
              {loading && pin.length === 4 && key !== '⌫' ? '' : key}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="mt-8 flex items-center gap-2 text-stone-400">
          <RefreshCw size={14} className="animate-spin" />
          <span className="text-[11px] font-black uppercase">Checking...</span>
        </div>
      )}

      <p className="mt-12 text-[9px] font-black text-stone-300 uppercase tracking-widest">The Sweet Tooth • Internal Use Only</p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ORDER CARD
// ─────────────────────────────────────────────────────────────────────────────

const OrderCard: React.FC<{ order: Delivery; role: AppRole; onTap: () => void; isSelected?: boolean; allUsers?: UserAccount[]; onUpdate?: (id: string, updates: Partial<Delivery>) => void }> = ({ order, role, onTap, allUsers, onUpdate }) => {
  const [reassignTo, setReassignTo] = useState('');
  const isAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';
  const handleReassign = async () => {
    if (!reassignTo || !allUsers || !onUpdate) return;
    const driver = allUsers.find(u => u.id === reassignTo);
    if (!driver) return;
    const isManualOrder = (order as any).isManual;
    await fetch(isManualOrder ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: driver.id, driverName: driver.name })
    });
    onUpdate(order.id, { driverId: driver.id, driverName: driver.name });
    setReassignTo('');
  };
  const product = order.items?.[0];
  const recipientName = order.giftReceiverName || order.customer?.name || '—';
  const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
  const attemptBadge = order.attemptNumber === 2 ? '2nd' : order.attemptNumber === 1 && order.status === 'FAILED' ? '1st' : null;
  return (
    <div onClick={onTap}
      className="flex items-stretch border-b border-stone-100 bg-white active:bg-stone-50 cursor-pointer transition-all">
      {/* Status stripe */}
      <div className={`w-1 shrink-0 ${statusCfg.bg}`} />
      {/* Main row */}
      <div className="flex-1 px-3 py-2.5 min-w-0">
        <div className="flex items-start justify-between gap-2">
          {/* Left: name + address */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-black text-stone-900 leading-tight">{recipientName}</p>
              {attemptBadge && (
                <span className="text-[9px] font-black bg-red-100 text-red-700 px-1.5 py-0.5 rounded uppercase">{attemptBadge} attempt</span>
              )}
            </div>
            <p className="text-base font-black text-black mt-0.5 leading-tight">{order.address?.city} {order.address?.zip}</p>
            <p className="text-[10px] text-stone-400 leading-tight truncate">{order.address?.street}</p>
            {product && <p className="text-[10px] text-stone-500 truncate mt-0.5">{product.name}{product.quantity > 1 ? ` ×${product.quantity}` : ''}</p>}
            {order.deliveryInstructions && (
              <div className="flex items-center gap-1 mt-1 bg-red-50 border border-red-200 rounded px-2 py-1">
                <AlertTriangle size={10} className="text-red-600 shrink-0" />
                <p className="text-[10px] font-black text-red-700 leading-tight truncate">{order.deliveryInstructions}</p>
              </div>
            )}
          </div>
          {/* Right: order# + status + fee */}
          <div className="shrink-0 text-right flex flex-col items-end gap-1">
            <p className="text-[11px] font-black text-stone-500">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.text}`}>{statusCfg.label}</span>
            {order.deliveryFee ? <p className="text-sm font-black text-green-700">${order.deliveryFee.toFixed(2)}</p> : null}
          </div>
        </div>
        {/* Driver row — admin: shows driver name + inline reassign dropdown + Save button */}
        {isAdmin && (
          <div className="mt-1.5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <select
              value={reassignTo || order.driverId || ''}
              onChange={e => setReassignTo(e.target.value)}
              className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none text-stone-700"
            >
              <option value="">👤 {order.driverName || 'Assign driver...'}</option>
              {allUsers?.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {reassignTo && reassignTo !== order.driverId && (
              <button
                onClick={handleReassign}
                className="shrink-0 bg-green-500 text-white text-xs font-black px-3 py-1.5 rounded-lg active:bg-green-600"
              >
                Save
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FAILED DELIVERY FLOW — 3 taps + reschedule modal
// ─────────────────────────────────────────────────────────────────────────────

interface FailedFlowProps {
  order: Delivery;
  currentUser: UserAccount;
  onSubmit: (reason: FailureReason, notes: string, photo: string | null) => void;
  onCancel: () => void;
}

const FailedDeliveryFlow: React.FC<FailedFlowProps> = ({ order, currentUser, onSubmit, onCancel }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [reason, setReason] = useState<FailureReason>('NO_ANSWER');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const canSubmit = notes.trim().length > 0 && photo !== null;

  return (
    <div className="fixed inset-0 bg-black/75 z-[200] flex items-end">
      <div className="w-full bg-white rounded-t-[40px] animate-in slide-in-from-bottom max-h-[90vh] overflow-y-auto">
        {/* Handle */}
        <div className="w-12 h-1 bg-stone-200 rounded-full mx-auto mt-4 mb-4" />

        {/* Step 1: What happens next — clear explanation */}
        {step === 1 && (
          <div className="px-6 pb-8 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black uppercase text-stone-900">Couldn't Deliver?</h3>
              <button onClick={onCancel}><X size={22} className="text-stone-400" /></button>
            </div>
            <p className="text-sm font-bold text-stone-500">Order #{order.orderNumber?.replace(/^#+/, '') || order.id} — {order.giftReceiverName || order.customer.name}</p>

            {/* What happens next callout */}
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl px-5 py-4 space-y-2">
              <p className="text-sm font-black text-amber-900 uppercase tracking-wide">Here's what happens next:</p>
              <div className="flex items-start gap-2">
                <span className="text-amber-700 font-black text-base mt-0.5">1.</span>
                <p className="text-sm font-bold text-amber-800">Select a reason why you couldn't deliver</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-amber-700 font-black text-base mt-0.5">2.</span>
                <p className="text-sm font-bold text-amber-800">Take a photo of the property (required — proof you were there)</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-amber-700 font-black text-base mt-0.5">3.</span>
                <p className="text-sm font-bold text-amber-800">Add a short note about what happened</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-green-700 font-black text-base mt-0.5">✓</span>
                <p className="text-sm font-bold text-green-800">Order automatically reschedules for next business day</p>
              </div>
            </div>

            <button onClick={() => setStep(2)} className="w-full py-6 bg-stone-900 text-white rounded-[28px] font-black uppercase tracking-widest text-sm active:scale-95 transition-all">
              Continue — Report This Attempt →
            </button>
            <button onClick={onCancel} className="w-full py-4 text-stone-400 font-bold text-sm">Cancel — Go Back</button>
          </div>
        )}

        {/* Step 2: Reason */}
        {step === 2 && (
          <div className="px-6 pb-8 space-y-5">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(1)} className="p-2 bg-stone-100 rounded-full"><ChevronLeft size={18} /></button>
              <div>
                <h3 className="text-xl font-black uppercase text-stone-900">Why couldn't you deliver?</h3>
                <p className="text-xs text-stone-400 font-bold">Step 1 of 2</p>
              </div>
              <button onClick={onCancel} className="ml-auto"><X size={22} className="text-stone-400" /></button>
            </div>
            <p className="text-xs text-stone-500 font-medium">Order #{order.orderNumber?.replace(/^#+/, '') || order.id} — {order.giftReceiverName || order.customer.name}</p>
            <div className="space-y-2">
              {(Object.entries(FAILURE_REASON_LABELS) as [FailureReason, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setReason(key)}
                  className={`w-full py-5 px-5 rounded-[20px] font-black text-sm text-left flex items-center gap-3 transition-all active:scale-98 ${reason === key ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700'}`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${reason === key ? 'border-white' : 'border-stone-300'}`}>
                    {reason === key && <div className="w-2.5 h-2.5 bg-white rounded-full" />}
                  </div>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setStep(3)} className="w-full py-6 bg-stone-900 text-white rounded-[28px] font-black uppercase tracking-widest text-sm active:scale-95 transition-all">
              Next — Add Photo &amp; Notes →
            </button>
          </div>
        )}

        {/* Step 3: Photo (required) + Notes + Submit */}
        {step === 3 && (
          <div className="px-6 pb-8 space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(2)} className="p-2 bg-stone-100 rounded-full"><ChevronLeft size={18} /></button>
              <div>
                <h3 className="text-lg font-black uppercase">Photo &amp; Notes</h3>
                <p className="text-[10px] font-black text-stone-400 uppercase">Step 2 of 2 · {FAILURE_REASON_LABELS[reason]}</p>
              </div>
            </div>

            {/* Photo — REQUIRED */}
            <input type="file" accept="image/*" ref={fileRef} onChange={handlePhoto} className="hidden" />
            <input type="file" accept="image/*" capture="environment" ref={cameraRef} onChange={handlePhoto} className="hidden" />
            <div>
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-widest block mb-2">
                📷 Photo of Property <span className="text-red-500">*Required</span>
              </label>
              {photo ? (
                <>
                  <img src={photo} className="w-full rounded-[18px] max-h-40 object-cover border border-stone-100 mb-2" alt="Proof" />
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => cameraRef.current?.click()}
                      className="py-3 rounded-[20px] font-black uppercase text-xs flex items-center justify-center gap-2 bg-green-50 text-green-700 border-2 border-green-400 active:scale-95 transition-all">
                      <Camera size={16} /> Retake
                    </button>
                    <button onClick={() => fileRef.current?.click()}
                      className="py-3 rounded-[20px] font-black uppercase text-xs flex items-center justify-center gap-2 bg-green-50 text-green-700 border-2 border-green-400 active:scale-95 transition-all">
                      🖼️ Library
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => cameraRef.current?.click()}
                      className="py-5 rounded-[20px] font-black uppercase text-xs flex items-center justify-center gap-2 bg-red-50 text-red-700 border-2 border-red-300 active:scale-95 transition-all">
                      <Camera size={18} /> Take Photo
                    </button>
                    <button onClick={() => fileRef.current?.click()}
                      className="py-5 rounded-[20px] font-black uppercase text-xs flex items-center justify-center gap-2 bg-red-50 text-red-700 border-2 border-red-300 active:scale-95 transition-all">
                      🖼️ Upload
                    </button>
                  </div>
                  <p className="text-[10px] font-black text-red-500 mt-1 text-center">You must take a photo before submitting</p>
                </>
              )}
            </div>

            {/* Notes — mandatory */}
            <div>
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-widest block mb-2">
                Driver Notes <span className="text-red-500">*Required</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Rang bell twice, no answer. Left notice at door."
                className="w-full bg-stone-50 border-2 border-stone-200 rounded-[20px] px-5 py-4 text-sm font-medium outline-none focus:border-stone-400 transition-all resize-none"
                style={{ minHeight: '90px' }}
              />
              {notes.trim().length === 0 && <p className="text-[10px] font-black text-red-400 mt-1">Notes are required before submitting</p>}
            </div>

            {/* Submit */}
            <button
              onClick={() => canSubmit && onSubmit(reason, notes, photo)}
              disabled={!canSubmit}
              className="w-full py-7 bg-stone-900 text-white rounded-[32px] font-black uppercase tracking-widest text-base flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-xl mt-2"
            >
              <XCircle size={24} /> SUBMIT — ORDER WILL RESCHEDULE
            </button>
            {!canSubmit && (
              <p className="text-center text-[11px] font-bold text-stone-400">
                {!photo && !notes.trim() ? 'Photo + notes required' : !photo ? 'Photo required' : 'Notes required'}
              </p>
            )}
          </div>
        )}

        {/* Step indicator dots */}
        <div className="flex justify-center gap-2 pb-4">
          {[1,2,3].map(s => (
            <div key={s} className={`h-1 rounded-full transition-all ${step === s ? 'w-8 bg-stone-800' : 'w-4 bg-stone-200'}`} />
          ))}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RESCHEDULE MODAL — appears after submit
// ─────────────────────────────────────────────────────────────────────────────

interface RescheduleModalProps {
  order: Delivery;
  failureReason: FailureReason;
  driverNotes: string;
  photo: string | null;
  onAutoReschedule: () => void;
  onManualReschedule: () => void;
}

const RescheduleModal: React.FC<RescheduleModalProps> = ({ order, failureReason, driverNotes, photo, onAutoReschedule, onManualReschedule }) => {
  const tomorrow = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();

  return (
    <div className="fixed inset-0 bg-black/80 z-[250] flex items-center justify-center p-5">
      <div className="w-full max-w-sm bg-white rounded-[36px] p-7 shadow-2xl animate-in zoom-in-95 space-y-5">
        <div className="text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <RotateCcw size={28} className="text-amber-600" />
          </div>
          <h3 className="text-xl font-black uppercase">Reschedule?</h3>
          <p className="text-sm text-stone-500 font-medium mt-2">Delivery for <span className="font-black text-stone-800">{order.giftReceiverName || order.customer.name}</span> was marked failed.</p>
        </div>

        <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100 space-y-1">
          <p className="text-[10px] font-black uppercase text-stone-400">Failure Reason</p>
          <p className="text-sm font-black text-stone-800">{FAILURE_REASON_LABELS[failureReason]}</p>
          {driverNotes && <p className="text-xs text-stone-500 italic mt-1">"{driverNotes}"</p>}
        </div>

        <button
          onClick={onAutoReschedule}
          className="w-full py-6 bg-black text-white rounded-[28px] font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 active:scale-95 transition-all shadow-lg"
        >
          <Calendar size={20} /> YES — Reschedule for {tomorrow}
        </button>

        <button
          onClick={onManualReschedule}
          className="w-full py-5 bg-stone-100 text-stone-700 rounded-[28px] font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <Inbox size={18} /> No — Send to Katie's Queue
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ORDER DETAIL
// ─────────────────────────────────────────────────────────────────────────────

const OrderDetail: React.FC<{
  order: Delivery;
  role: AppRole;
  currentUser: UserAccount;
  allUsers: UserAccount[];
  onUpdate: (id: string, updates: Partial<Delivery>) => void;
  onAddDelivery: (delivery: Delivery) => void;
  onBack: () => void;
  stopNumber?: number;
}> = ({ order, role, currentUser, allUsers, onUpdate, onAddDelivery, onBack, stopNumber }) => {
  const [photoData, setPhotoData] = useState<string | null>(order.confirmationPhoto || null);
  const [sigData, setSigData] = useState<string | null>(order.confirmationSignature || null);
  const [driverNote, setDriverNote] = useState(order.driverNotes || '');
  const [showFailFlow, setShowFailFlow] = useState(false);
  const [pendingFailure, setPendingFailure] = useState<{ reason: FailureReason; notes: string; photo: string | null } | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [showNotifyPreview, setShowNotifyPreview] = useState<null | 'SUCCESS' | 'FAILURE'>(null);
  const [notifyPreviewText, setNotifyPreviewText] = useState('');
  const [notifyChannel, setNotifyChannel] = useState('');
  const [notifySent, setNotifySent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSavingPOD, setIsSavingPOD] = useState(false);
  const [notifyError, setNotifyError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const isAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';
  const isCompleted = order.status === DeliveryStatus.DELIVERED || order.status === DeliveryStatus.FAILED || order.status === DeliveryStatus.PENDING_RESCHEDULE || order.status === DeliveryStatus.SECOND_ATTEMPT;

  // When opening a delivered order, fetch fresh POD data from DB
  useEffect(() => {
    if (isCompleted && order.id) {
      fetch(`/api/pod/${order.id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && data.pod) {
            const pod = data.pod;
            const photo = pod.confirmationPhoto || pod.photo || null;
            const sig = pod.confirmationSignature || pod.signature || null;
            if (photo && !order.confirmationPhoto) onUpdate(order.id, { confirmationPhoto: photo });
            if (sig && !order.confirmationSignature) onUpdate(order.id, { confirmationSignature: sig });
            if (pod.completedAt && !order.completedAt) onUpdate(order.id, { completedAt: pod.completedAt });
            if (pod.driverNotes || pod.notes) onUpdate(order.id, { driverNotes: pod.driverNotes || pod.notes });
          }
        })
        .catch(() => {});
    }
  }, [order.id, isCompleted]);

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const now = new Date();
    const stamp = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const r = new FileReader();
    r.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        // Stamp bar at bottom
        const barH = Math.max(48, img.height * 0.07);
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(0, img.height - barH, img.width, barH);
        // Timestamp text
        const fontSize = Math.max(22, img.width * 0.038);
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText('📍 The Sweet Tooth  ·  ' + stamp, img.width * 0.025, img.height - barH / 2);
        const stamped = canvas.toDataURL('image/jpeg', 0.92);
        setPhotoData(stamped);
        setPhotoTimestamp(now.toISOString());
      };
      img.src = r.result as string;
    };
    r.readAsDataURL(f);
  };

  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [showDeliveredConfirm, setShowDeliveredConfirm] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showAdminOverrideConfirm, setShowAdminOverrideConfirm] = useState(false);
  const [showNavChoice, setShowNavChoice] = useState(false);
  const [statusSaveToast, setStatusSaveToast] = useState<'saved' | 'error' | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pendingDate, setPendingDate] = useState(order.deliveryDate || '');
  const [dateSavedToast, setDateSavedToast] = useState(false);
  const [navAddress, setNavAddress] = useState('');
  
  // Admin controls pending state
  const [pendingStatus, setPendingStatus] = useState(order.status);
  const [pendingDriver, setPendingDriver] = useState(order.driverId || '');
  const [pendingDeliveryDate, setPendingDeliveryDate] = useState((order.deliveryDate || '').split('T')[0]);
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminSaveResult, setAdminSaveResult] = useState<'saved' | 'error' | null>(null);
  
  // Sync pending states when order prop changes (e.g., after save or external update)
  useEffect(() => {
    setPendingStatus(order.status);
    setPendingDriver(order.driverId || '');
    setPendingDeliveryDate((order.deliveryDate || '').split('T')[0]);
    setPendingDate(order.deliveryDate || '');
  }, [order.id, order.status, order.driverId, order.deliveryDate]);
  
  // Track if any pending changes exist
  const hasAdminChanges = pendingStatus !== order.status || 
    pendingDriver !== (order.driverId || '') || 
    pendingDeliveryDate !== (order.deliveryDate || '').split('T')[0];


  const handleComplete = async () => {
    if (isSavingPOD) return; // prevent double-submit
    const now = new Date().toISOString();
    const isManualOrder = (order as any).isManual;

    // Record-first, never gatekeep. The driver handed chocolate to a real person —
    // the app's job is to RECORD that, not block on DB state. Order:
    //   1) mark delivered in UI   2) update Shopify/manual tag
    //   3) show driver success    4) attempt POD save (never blocking)
    const updates: Partial<Delivery> = { status: DeliveryStatus.DELIVERED, confirmationPhoto: photoData || undefined, confirmationSignature: sigData || undefined, driverNotes: driverNote, completedAt: now, submittedAt: now };
    onUpdate(order.id, updates);

    try {
      if (isManualOrder) {
        await fetch(`/api/manual-orders/${order.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DELIVERED', completedAt: now, confirmationPhoto: photoData || null, driverNotes: driverNote }) });
      } else {
        await fetch(`/api/orders/${order.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DELIVERED', completedAt: now }) });
      }
    } catch (err) { console.error('status update failed (non-blocking):', err); }

    setShowDeliveredConfirm(true);

    // Auto-open SMS for phone-only orders (no email)
    const customerEmail = order.customer?.email || '';
    const senderPhone = order.giftSenderPhone || '';
    if (!customerEmail && senderPhone) {
      const cleanPhone = senderPhone.replace(/\D/g, '');
      const receiverName = order.giftReceiverName || 'the recipient';
      const smsMessage = `Great news! Your Sweet Tooth gift to ${receiverName} has been delivered. Thank you for your order! 🍫 - The Sweet Tooth`;
      setTimeout(() => {
        window.location.href = `sms:${cleanPhone}?body=${encodeURIComponent(smsMessage)}`;
      }, 2000);
    }

    // Save POD + fire server-side confirmation email. Never block the driver on this;
    // the photo stays on the phone as a natural backup if the DB write fails.
    setIsSavingPOD(true);
    try {
      await fetch('/api/pod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, photo: photoData, signature: sigData, notes: driverNote, completedAt: now, status: 'DELIVERED', driverId: currentUser.id, driverName: currentUser.name, isManual: isManualOrder, customerEmail: order.giftSenderEmail || order.customer?.email || '', giftReceiverName: order.giftReceiverName || '', giftSenderName: order.giftSenderName || '', address: order.address || '', orderNumber: order.orderNumber || '' }) });
    } catch (err) {
      console.error('POD save failed (non-blocking):', err);
    }
    setIsSavingPOD(false);

    setTimeout(() => { setShowDeliveredConfirm(false); onBack(); }, 2500);
  };

  const handleAdminOverride = async () => {
    if (isSavingPOD) return;
    const now = new Date().toISOString();
    const isManualOrder = (order as any).isManual;

    const updates: Partial<Delivery> = { status: DeliveryStatus.DELIVERED, driverNotes: driverNote || 'Admin override — marked delivered manually', completedAt: now, submittedAt: now };
    onUpdate(order.id, updates);

    try {
      if (isManualOrder) {
        await fetch(`/api/manual-orders/${order.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DELIVERED', completedAt: now, driverNotes: driverNote || 'Admin override' }) });
      } else {
        await fetch(`/api/orders/${order.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'DELIVERED', completedAt: now }) });
      }
    } catch (err) { console.error('status update failed (non-blocking):', err); }

    setShowAdminOverrideConfirm(false);
    setShowDeliveredConfirm(true);

    // Save POD in the background; never block the admin on DB state.
    setIsSavingPOD(true);
    try {
      await fetch('/api/pod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, notes: driverNote || 'Admin override — marked delivered manually', completedAt: now, status: 'DELIVERED', driverId: currentUser.id, driverName: currentUser.name, isManual: isManualOrder, adminOverride: true }) });
    } catch (err) {
      console.error('POD save failed (non-blocking):', err);
    }
    setIsSavingPOD(false);

    setTimeout(() => { setShowDeliveredConfirm(false); onBack(); }, 2500);
  };

  const handleRevert = async () => {
    const updates: Partial<Delivery> = {
      status: DeliveryStatus.ASSIGNED,
      confirmationPhoto: undefined,
      confirmationSignature: undefined,
      driverNotes: '',
      completedAt: undefined,
      submittedAt: undefined,
      successNotificationSent: false,
    };
    onUpdate(order.id, updates);
    await fetch(`/api/orders/${order.id}/revert`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    setShowRevertConfirm(false);
    onBack();
  };

  const handleFailSubmit = async (reason: FailureReason, notes: string, photo: string | null) => {
    if (isSavingPOD) return;
    const now = new Date().toISOString();

    // Mark failed + open the reschedule flow immediately. Never block on DB state —
    // the driver still needs to call the sender and pick a next step.
    const attempt = { id: Date.now().toString(), timestamp: now, driverId: currentUser.id, driverName: currentUser.name, attemptNumber: (order.attemptNumber || 1) as 1 | 2, reason, notes, photo: photo || undefined };
    onUpdate(order.id, { status: DeliveryStatus.FAILED, confirmationPhoto: photo || undefined, driverNotes: notes, submittedAt: now, attempts: [...(order.attempts || []), attempt] });
    setPendingFailure({ reason, notes, photo });
    setShowFailFlow(false);
    setShowReschedule(true);

    setIsSavingPOD(true);
    try {
      await fetch('/api/pod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, photo, notes, submittedAt: now, status: 'FAILED', driverId: currentUser.id, driverName: currentUser.name, failureReason: reason }) });
    } catch (err) {
      console.error('POD save failed (non-blocking):', err);
    }
    setIsSavingPOD(false);
  };

  const handleAutoReschedule = async () => {
    const res = await fetch('/api/reschedule/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: { ...order, ...pendingFailure } }) });
    const data = await res.json();
    if (data.rescheduledOrder) onAddDelivery({ ...data.rescheduledOrder, attemptNumber: 2, originalDeliveryId: order.id });
    // Mark original as FAILED (1st attempt) with attemptNumber=1
    onUpdate(order.id, { status: DeliveryStatus.FAILED, attemptNumber: 1 });
    setShowReschedule(false);
  };

  const handleManualReschedule = async () => {
    await fetch('/api/reschedule/pending', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, failureReason: pendingFailure?.reason, driverNotes: pendingFailure?.notes, photo: pendingFailure?.photo }) });
    onUpdate(order.id, { status: DeliveryStatus.PENDING_RESCHEDULE });
    setShowReschedule(false);
  };

  const loadPreview = async (type: 'SUCCESS' | 'FAILURE') => {
    const res = await fetch('/api/notify/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, order, failureReason: pendingFailure ? FAILURE_REASON_LABELS[pendingFailure.reason] : '', driverNotes: order.driverNotes || '' }) });
    const data = await res.json();
    // Determine channel: SMS to gift sender if they have phone but no email, otherwise email
    const email = order.customer?.email;
    const senderPhone = order.giftSenderPhone;
    const channel = (!email && senderPhone) ? 'SMS' : data.channel;
    setNotifyPreviewText(data.preview); setNotifyChannel(channel); setShowNotifyPreview(type); setNotifySent(false);
  };

  const handleSend = async () => {
    if (!showNotifyPreview) return;
    if (!isWithinSendingHours()) { setNotifyError('Messages can only be sent between 9 AM and 8 PM.'); return; }
    
    const email = order.customer?.email;
    const senderPhone = order.giftSenderPhone;
    
    // If no email but gift sender has phone, open SMS app with pre-filled message
    if (!email && senderPhone) {
      const cleanPhone = senderPhone.replace(/\D/g, '');
      const smsBody = encodeURIComponent(notifyPreviewText);
      window.location.href = `sms:${cleanPhone}?body=${smsBody}`;
      setNotifySent(true);
      setNotifyChannel('SMS');
      onUpdate(order.id, showNotifyPreview === 'SUCCESS' ? { successNotificationSent: true } : { failureNotificationSent: true });
      return;
    }
    
    setIsSending(true);
    setNotifyError('');
    try {
      const res = await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: showNotifyPreview, order, failureReason: pendingFailure ? FAILURE_REASON_LABELS[pendingFailure.reason] : '', driverNotes: order.driverNotes || '' }) });
      const data = await res.json();
      setIsSending(false);
      if (data.sent) {
        setNotifySent(true);
        setNotifyChannel(data.channel || notifyChannel);
        onUpdate(order.id, showNotifyPreview === 'SUCCESS' ? { successNotificationSent: true } : { failureNotificationSent: true });
      } else {
        setNotifyError(data.error || 'Could not send — no email or phone on file for this order.');
      }
    } catch {
      setIsSending(false);
      setNotifyError('Network error — please try again.');
    }
  };

  const handleAddNote = async () => {
    if (!adminNote.trim()) return;
    try {
      const r = await fetch(`/api/orders/${order.id}/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: adminNote }) });
      const ts = `[${new Date().toLocaleString()}] ${adminNote}`;
      onUpdate(order.id, { adminNotes: order.adminNotes ? `${order.adminNotes}\n${ts}` : ts });
      if (r.ok) {
        logAudit('NOTE_ADDED', 'adminNotes', '', adminNote);
        setStatusSaveToast('saved');
        setTimeout(() => setStatusSaveToast(null), 2500);
      } else { setStatusSaveToast('error'); setTimeout(() => setStatusSaveToast(null), 3500); }
    } catch { setStatusSaveToast('error'); setTimeout(() => setStatusSaveToast(null), 3500); }
    setAdminNote('');
  };

  const handleReassign = async () => {
    if (!reassignTo) return;
    const driver = allUsers.find(u => u.id === reassignTo); if (!driver) return;
    const isManualOrder = (order as any).isManual;
    const prevDriver = order.driverName || '';
    try {
      const r = await fetch(isManualOrder ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId: driver.id, driverName: driver.name })
      });
      onUpdate(order.id, { driverId: driver.id, driverName: driver.name });
      if (r.ok) {
        logAudit('DRIVER_REASSIGN', 'driver', prevDriver, driver.name);
        setStatusSaveToast('saved');
        setTimeout(() => setStatusSaveToast(null), 2500);
      } else { setStatusSaveToast('error'); setTimeout(() => setStatusSaveToast(null), 3500); }
    } catch { setStatusSaveToast('error'); setTimeout(() => setStatusSaveToast(null), 3500); }
    setReassignTo('');
  };

  // ── Audit log helper ──────────────────────────────────────────────────────
  const logAudit = (action: string, field: string, oldVal: string, newVal: string) => {
    fetch('/api/audit-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        orderNumber: order.orderNumber || order.id,
        actorId: currentUser.id,
        actorName: currentUser.name,
        action,
        field,
        oldValue: oldVal,
        newValue: newVal,
      }),
    }).catch(() => {});
  };

  const [showGiftMsg, setShowGiftMsg] = useState(false);
  const [showContactSection, setShowContactSection] = useState(false);
  const [photoTimestamp, setPhotoTimestamp] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [editFields, setEditFields] = useState({
    recipientName: order.giftReceiverName || order.customer?.name || '',
    recipientPhone: order.customer?.phone || '',
    recipientEmail: order.customer?.email || '',
    street: order.address?.street || '',
    city: order.address?.city || '',
    zip: order.address?.zip || '',
    senderName: order.giftSenderName || '',
    senderPhone: order.giftSenderPhone || '',
    deliveryFee: String(order.deliveryFee ?? ''),
  });

  const handleSaveContact = async () => {
    const updates: Partial<Delivery> = {
      customer: { name: editFields.recipientName, phone: editFields.recipientPhone, email: editFields.recipientEmail },
      address: { ...order.address, street: editFields.street, city: editFields.city, zip: editFields.zip },
      giftReceiverName: editFields.recipientName,
      giftSenderName: editFields.senderName,
      giftSenderPhone: editFields.senderPhone,
    };
    if (role === 'SUPER_ADMIN' || role === 'MANAGER') {
      updates.deliveryFee = parseFloat(editFields.deliveryFee) || order.deliveryFee;
    }
    onUpdate(order.id, updates);
    try {
      const r = await fetch(`/api/orders/${order.id}/edit`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (r.ok) {
        logAudit('CONTACT_EDIT', 'contact/address', order.giftReceiverName || '', editFields.recipientName);
        setStatusSaveToast('saved');
        setTimeout(() => setStatusSaveToast(null), 2500);
      } else { setStatusSaveToast('error'); setTimeout(() => setStatusSaveToast(null), 3500); }
    } catch { setStatusSaveToast('error'); setTimeout(() => setStatusSaveToast(null), 3500); }
    setEditingContact(false);
  };

  const recipientPhone = editingContact ? editFields.recipientPhone : (order.customer?.phone || '');
  const senderPhone = editingContact ? editFields.senderPhone : (order.giftSenderPhone || '');
  const recipientName = editingContact ? editFields.recipientName : (order.giftReceiverName || order.customer?.name || '');
  const senderName = editingContact ? editFields.senderName : (order.giftSenderName || '');
  const cleanOrderNum = order.orderNumber?.replace(/^#+/, '') || order.id;

  // Print Label Function — generates 4x6 thermal label
  const printLabel = () => {
    const driverName = order.driverName || currentUser.name || 'Driver';
    const deliveryDate = order.deliveryDate 
      ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const city = (order.address?.city || 'MIAMI').toUpperCase();
    const itemCount = order.items?.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0) || 1;
    const itemNames = order.items?.map((it: any) => it.name).join(', ') || 'Gift Basket';
    const hasGiftCard = order.giftMessage ? true : false;
    const gateCode = order.deliveryInstructions || '';
    const receiverPhone = order.customer?.phone || '';
    const senderPhoneNum = order.giftSenderPhone || '';
    const receiverName = order.giftReceiverName || order.customer?.name || '';
    const is2ndAttempt = order.attemptNumber === 2;
    const stopNum = stopNumber || 1;

    const css = `
  & { font-family: 'Arial Black', Arial, sans-serif; }
  * { margin: 0; padding: 0; box-sizing: border-box; }

  .single-label {
    width: 4in;
    min-height: 6in;
    padding: 0.15in;
    display: flex;
    flex-direction: column;
    page-break-after: always;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 6px;
    border-bottom: 2px solid #000;
    margin-bottom: 8px;
  }
  .driver-name { font-size: 14px; font-weight: 900; text-transform: uppercase; }
  .date { font-size: 11px; font-weight: 700; }
  .stop-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .stop-box {
    border: 3px solid #000;
    width: 50px;
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 32px;
    font-weight: 900;
  }
  .city { font-size: 22px; font-weight: 900; text-transform: uppercase; flex: 1; }
  .order-num { font-size: 14px; font-weight: 700; color: #666; }
  .info-section { margin-bottom: 6px; }
  .field-label { font-size: 10px; color: #666; text-transform: uppercase; }
  .value { font-size: 13px; font-weight: 700; }
  .items-row { margin-bottom: 6px; }
  .gift-card { display: flex; align-items: center; gap: 4px; margin-bottom: 6px; }
  .checkmark { font-size: 16px; }
  .phone-row { margin-bottom: 4px; }
  .address-section { margin-bottom: 8px; }
  .street { font-size: 12px; font-weight: 600; }
  .instructions { font-size: 11px; font-weight: 600; margin-bottom: 6px; padding: 4px 6px; background: #f5f5f5; border-left: 3px solid #000; }

  .tear-off {
    margin-top: auto;
    border-top: 2px dashed #999;
    padding-top: 8px;
  }
  .tear-header {
    font-size: 11px;
    font-weight: 900;
    text-align: center;
    margin-bottom: 4px;
  }
  .tear-info {
    font-size: 11px;
    font-weight: 700;
    text-align: center;
  }
`;

    const content = `
<div class="single-label">
  <div class="header">
    <span class="driver-name">${driverName}</span>
    <span class="date">${deliveryDate}</span>
  </div>

  <div class="stop-row">
    <div class="stop-box">${stopNum}</div>
    <span class="city">${city}</span>
    <span class="order-num">#${cleanOrderNum}</span>
  </div>

  <div class="info-section">
    <span class="field-label">Gift Receiver:</span>
    <span class="value">${receiverName}</span>
  </div>

  <div class="items-row">
    <span class="value">📦 ${itemCount} items: ${itemNames.substring(0, 50)}${itemNames.length > 50 ? '...' : ''}</span>
  </div>

  ${hasGiftCard ? '<div class="gift-card"><span class="checkmark">✓</span><span class="value">Gift Card</span></div>' : ''}

  ${gateCode ? '<div class="instructions">' + gateCode.substring(0, 80) + '</div>' : ''}

  <div class="phone-row">
    <span class="value">Receiver: ${receiverPhone || '—'}</span>
  </div>

  <div class="phone-row">
    <span class="value">Sender: ${senderPhoneNum || '—'}</span>
  </div>

  <div class="address-section">
    <div class="street">${order.address?.street || ''}</div>
    <div class="street">${order.address?.unit ? 'Unit ' + order.address.unit + ', ' : ''}${city}, FL ${order.address?.zip || ''}</div>
  </div>

  <div class="tear-off">
    <div class="tear-header">
      ${is2ndAttempt ? 'FAILED 2ND ATTEMPT' : 'FAILED 1ST ATTEMPT'}
    </div>
    <div class="tear-info">#${cleanOrderNum} | ${receiverName.split(' ')[0] || 'Customer'} | ${city}</div>
  </div>
</div>`;

    showPrintPreview({
      content,
      css,
      title: `Label #${cleanOrderNum} · Stop ${stopNum}`,
      pageSize: '4in 6in',
    });
  };

  const openNavChoice = (addr: string) => {
    setNavAddress(addr);
    setShowNavChoice(true);
  };

  const openNavApp = (app: 'google' | 'waze') => {
    setShowNavChoice(false);
    if (app === 'google') {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navAddress)}`, '_blank');
    } else {
      window.open(`https://waze.com/ul?q=${encodeURIComponent(navAddress)}&navigate=yes`, '_blank');
    }
  };


  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ── DELIVERY CONFIRMED OVERLAY — High-fidelity success animation ── */}
      {showDeliveredConfirm && (
        <div className="fixed inset-0 z-[999] bg-gradient-to-b from-green-400 to-green-600 flex flex-col items-center justify-center">
          <style>{`
            @keyframes checkScale {
              0% { transform: scale(0); opacity: 0; }
              50% { transform: scale(1.2); }
              100% { transform: scale(1); opacity: 1; }
            }
            @keyframes checkDraw {
              0% { stroke-dashoffset: 60; }
              100% { stroke-dashoffset: 0; }
            }
            @keyframes fadeUp {
              0% { opacity: 0; transform: translateY(20px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            @keyframes pulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.05); }
            }
            .success-circle { animation: checkScale 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
            .success-check { stroke-dasharray: 60; stroke-dashoffset: 60; animation: checkDraw 0.4s ease-out 0.3s forwards; }
            .success-text { animation: fadeUp 0.4s ease-out 0.5s forwards; opacity: 0; }
            .success-pulse { animation: pulse 1.5s ease-in-out infinite 0.8s; }
          `}</style>
          <div className="flex flex-col items-center gap-6">
            <div className="success-circle success-pulse w-32 h-32 rounded-full bg-white flex items-center justify-center shadow-2xl">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline className="success-check" points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="text-center success-text">
              <p className="text-white text-4xl font-black uppercase tracking-widest drop-shadow-lg">Delivered!</p>
              <p className="text-white/80 text-base font-bold mt-2">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── NAVIGATION APP CHOICE POPUP ── */}
      {showNavChoice && (
        <div className="fixed inset-0 z-[998] bg-black/50 flex items-end justify-center" onClick={() => setShowNavChoice(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-8 space-y-3" onClick={e => e.stopPropagation()}>
            <p className="text-center text-sm font-black uppercase text-stone-500 tracking-widest mb-2">Open with</p>
            <button onClick={() => openNavApp('google')}
              className="flex items-center justify-center gap-3 w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-base active:scale-95">
              🗺️ Google Maps
            </button>
            <button onClick={() => openNavApp('waze')}
              className="flex items-center justify-center gap-3 w-full py-4 bg-[#33ccff] text-white rounded-2xl font-black text-base active:scale-95">
              🚗 Waze
            </button>
            <button onClick={() => setShowNavChoice(false)}
              className="w-full py-3 text-stone-400 font-bold text-sm active:scale-95">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── DATE PICKER MODAL ── */}
      {showDatePicker && (
        <div className="fixed inset-0 z-[998] bg-black/50 flex items-end justify-center" onClick={() => setShowDatePicker(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
            <p className="text-center text-sm font-black uppercase text-stone-500 tracking-widest">Reschedule Delivery</p>
            <p className="text-center text-xs text-stone-400">Order #{cleanOrderNum} — {order.giftReceiverName || order.customer?.name}</p>
            <input type="date" value={pendingDate} onChange={e => setPendingDate(e.target.value)}
              className="w-full border-2 border-stone-300 rounded-xl px-4 py-3 text-lg font-bold text-center focus:border-amber-500 focus:outline-none" />
            {pendingDate && pendingDate !== order.deliveryDate && (
              <p className="text-center text-sm font-bold text-amber-700">
                → {new Date(pendingDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            )}
            <button onClick={async () => {
              const prevDate = order.deliveryDate || '';
              onUpdate(order.id, { deliveryDate: pendingDate });
              try {
                const r = await fetch(`/api/orders/${order.id}/edit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryDate: pendingDate }) });
                if (r.ok) {
                  logAudit('DATE_CHANGE', 'deliveryDate', prevDate, pendingDate);
                  setStatusSaveToast('saved');
                  setTimeout(() => setStatusSaveToast(null), 2500);
                } else {
                  setStatusSaveToast('error');
                  setTimeout(() => setStatusSaveToast(null), 3500);
                }
              } catch {
                setStatusSaveToast('error');
                setTimeout(() => setStatusSaveToast(null), 3500);
              }
              setShowDatePicker(false);
              setDateSavedToast(true);
              setTimeout(() => setDateSavedToast(false), 3000);
            }} disabled={!pendingDate || pendingDate === order.deliveryDate}
              className={`w-full py-4 rounded-2xl font-black text-base active:scale-95 ${!pendingDate || pendingDate === order.deliveryDate ? 'bg-stone-200 text-stone-400' : 'bg-green-600 text-white'}`}>
              ✓ Confirm New Date
            </button>
            <button onClick={() => setShowDatePicker(false)}
              className="w-full py-3 text-stone-400 font-bold text-sm active:scale-95">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── DATE SAVED TOAST ── */}
      {dateSavedToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[999] bg-green-600 text-white px-6 py-3 rounded-2xl shadow-lg font-black text-sm flex items-center gap-2 animate-bounce">
          ✓ Delivery rescheduled successfully
        </div>
      )}

      {/* ── HEADER ── */}
      <div className="bg-black text-white px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center bg-white/10 rounded-full active:bg-white/20">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xl font-black tracking-tight">#{cleanOrderNum}</p>
          <p className={`text-xs font-bold ${order.deliveryDate ? 'text-white' : 'text-amber-300'}`}>
            {order.deliveryDate ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }) : '⚠ No date'}
          </p>
        </div>
        <span className={`text-xs font-black px-3 py-1.5 rounded-full border ${order.status === DeliveryStatus.DELIVERED ? 'bg-green-500 border-green-400 text-white' : 'bg-white/10 border-white/20 text-white'}`}>
          {STATUS_CONFIG[order.status]?.label || order.status}
        </span>
        {isAdmin && (order as any).isManual && (
          <button
            onClick={async () => {
              if (!confirm('Delete this manual delivery? This cannot be undone.')) return;
              await fetch(`/api/manual-orders/${order.id}`, { method: 'DELETE' });
              onBack();
            }}
            className="w-9 h-9 flex items-center justify-center bg-red-500/80 rounded-full active:bg-red-600 ml-1"
            title="Delete manual order"
          >
            <Trash2 size={14} className="text-white" />
          </button>
        )}
        {/* Print Label Button */}
        <button
          onClick={printLabel}
          className="w-9 h-9 flex items-center justify-center bg-white/20 rounded-full active:bg-white/30 ml-1"
          title="Print Label"
        >
          <Printer size={14} className="text-white" />
        </button>
      </div>

      {/* ── STATUS SAVE TOAST ── */}
      {statusSaveToast && (
        <div style={{
          position: 'fixed', top: 64, left: '50%', transform: 'translateX(-50%)',
          background: statusSaveToast === 'saved' ? '#16A34A' : '#DC2626',
          color: '#fff', borderRadius: 12, padding: '10px 20px',
          fontSize: 14, fontWeight: 800, zIndex: 9999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          display: 'flex', alignItems: 'center', gap: 8,
          whiteSpace: 'nowrap',
        }}>
          {statusSaveToast === 'saved' ? '✓ Status saved' : '⚠ Save failed — try again'}
        </div>
      )}

      {/* ── SCROLLABLE CONTENT ── */}
      <div className="flex-1 overflow-y-auto pb-6" style={{ background: '#FFFFFF' }}>

        {/* ── DELIVERY INSTRUCTIONS — Subtle but visible ── */}
        {order.deliveryInstructions && (
          <div style={{ background: '#FEF3C7', padding: '12px 16px', borderLeft: '3px solid #F59E0B' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Delivery Instructions</p>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#78350F' }}>{order.deliveryInstructions}</p>
          </div>
        )}

        {/* ── ORDER INFO CARD — Matching orders list style ── */}
        <div style={{ padding: '12px 16px' }}>
          
          {/* RECIPIENT + ADDRESS CARD */}
          <div style={{ background: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #E5E7EB' }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Delivering To</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 16 }}>{recipientName}</p>
            
            <p style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Address</p>
            <button 
              onClick={() => openNavChoice([order.address?.street, order.address?.unit, order.address?.city, 'FL', order.address?.zip].filter(Boolean).join(' '))}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <p style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 2 }}>{order.address.street}{order.address.unit ? ` #${order.address.unit}` : ''}</p>
              {order.address.company && <p style={{ fontSize: 13, fontWeight: 500, color: '#6B7280', marginBottom: 2 }}>📍 {order.address.company}</p>}
              <p style={{ fontSize: 13, color: '#2563EB' }}>{order.address.city}, {order.address.zip}</p>
              <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>Tap to open in Maps →</p>
            </button>
          </div>

          {/* ITEMS CARD */}
          {order.items?.length > 0 && (
            <div style={{ background: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #E5E7EB' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Items</p>
                <p style={{ fontSize: 13, fontWeight: 800, color: '#111827', background: '#F3F4F6', padding: '4px 10px', borderRadius: 9999 }}>
                  {order.items.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0)} {order.items.reduce((sum: number, it: any) => sum + (it.quantity || 1), 0) === 1 ? 'product' : 'products'}
                </p>
              </div>
              
              {order.items.map((item, i) => (
                <div key={i} style={{ paddingBottom: 12, marginBottom: 12, borderBottom: i < order.items.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ background: '#F3F4F6', color: '#374151', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999 }}>×{item.quantity}</span>
                    <p style={{ fontSize: 15, fontWeight: 600, color: '#111827', flex: 1 }}>{item.name}</p>
                  </div>
                  {item.variantTitle && (
                    <p style={{ fontSize: 12, color: '#6B7280', marginTop: 4, marginLeft: 40 }}>{item.variantTitle}</p>
                  )}
                  {item.properties && item.properties.length > 0 && (
                    <div style={{ marginTop: 8, marginLeft: 40 }}>
                      {item.properties.filter((prop: any) => {
                        const n = prop.name?.toLowerCase() || '';
                        return !n.includes('delivery fee') && !n.includes('_') && prop.value && prop.value !== 'null';
                      }).map((prop: any, pi: number) => {
                        const isSpecialInstruction = prop.name?.toLowerCase().includes('special instruction') || prop.name?.toLowerCase().includes('special_instruction');
                        return isSpecialInstruction ? null : (
                          <p key={pi} style={{ fontSize: 12, color: '#6B7280', marginBottom: 2 }}>
                            <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 10, color: '#9CA3AF' }}>{prop.name}: </span>
                            {prop.value}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              
              {/* Special Instructions — inline, not a loud banner */}
              {order.items.some((item: any) => item.properties?.some((prop: any) => {
                const n = prop.name?.toLowerCase() || '';
                return (n.includes('special instruction') || n.includes('special_instruction')) && prop.value && prop.value !== 'null';
              })) && (
                <div style={{ background: '#FEF3C7', borderRadius: 8, padding: 12, marginTop: 8, borderLeft: '3px solid #F59E0B' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>⚠ Special Instructions</p>
                  {order.items.map((item: any, i: number) => 
                    item.properties?.filter((prop: any) => {
                      const n = prop.name?.toLowerCase() || '';
                      return (n.includes('special instruction') || n.includes('special_instruction')) && prop.value && prop.value !== 'null';
                    }).map((prop: any, pi: number) => (
                      <p key={`${i}-${pi}`} style={{ fontSize: 14, fontWeight: 600, color: '#78350F' }}>{prop.value}</p>
                    ))
                  )}
                </div>
              )}

              {/* Totals row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 12, borderTop: '1px solid #F3F4F6' }}>
                <p style={{ fontSize: 12, color: '#6B7280' }}>
                  <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 10, color: '#9CA3AF' }}>Total: </span>
                  <span style={{ fontWeight: 700, color: '#374151' }}>${order.items.reduce((sum: number, it: any) => sum + ((it.price || 0) * (it.quantity || 1)), 0).toFixed(2) || order.orderTotal?.toFixed(2) || '—'}</span>
                </p>
                {(() => {
                  const fee = order.deliveryFee || DELIVERY_FEES[order.address?.zip || ''] || 0;
                  return fee > 0 ? (
                    <p style={{ fontSize: 12, color: '#6B7280' }}>
                      <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 10, color: '#9CA3AF' }}>Delivery Fee: </span>
                      <span style={{ fontWeight: 700, color: '#374151' }}>${fee.toFixed(2)}</span>
                    </p>
                  ) : null;
                })()}
              </div>
            </div>
          )}

          {/* GIFT FROM CARD */}
          {(order.giftSenderName || order.giftSenderPhone) && (
            <div style={{ background: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #E5E7EB' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Gift From</p>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{order.giftSenderName || '—'}</p>
              {order.giftSenderPhone && (
                <p style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>{order.giftSenderPhone}</p>
              )}
            </div>
          )}

          {/* GIFT MESSAGE CARD */}
          {order.giftMessage && (
            <div style={{ background: '#FDF2F8', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #EC4899' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#BE185D', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>🎁 Gift Message</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: '#831843', fontStyle: 'italic', lineHeight: 1.5 }}>"{order.giftMessage}"</p>
            </div>
          )}

          {/* ORDER TOTAL CARD */}
          <div style={{ background: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {order.orderTotal != null && (
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Order Total</p>
                <p style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>${order.orderTotal.toFixed(2)}</p>
              </div>
            )}
            {order.createdAt && (
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Order Date</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                  {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </div>
            )}
          </div>

        </div>

        {/* ── ZONE 2: CONTACT — Matching card style ── */}
        {!isCompleted && (
          <div style={{ padding: '0 16px' }}>
            <div 
              onClick={() => setShowContactSection(s => !s)}
              style={{ background: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #E5E7EB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Phone size={18} className="text-stone-400" />
                <span style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Need to call someone?</span>
              </div>
              <ChevronRight size={18} className={`text-stone-400 transition-transform ${showContactSection ? 'rotate-90' : ''}`} />
            </div>

            {showContactSection && (
              <div style={{ background: '#ffffff', borderRadius: 12, padding: 16, marginTop: -8, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #E5E7EB' }}>
                {/* Recipient */}
                <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #F3F4F6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ background: '#22C55E', color: 'white', fontSize: 11, fontWeight: 700, width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Try Recipient First</span>
                  </div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 8 }}>{recipientName}</p>
                  {recipientPhone ? (
                    <ContactCallReveal phone={recipientPhone} label="Receiver" showTemplates={true} driverName={currentUser.name} driverPhone={currentUser.phone || ''} address={[order.address?.street, order.address?.unit].filter(Boolean).join(', ')} />
                  ) : (
                    <p style={{ fontSize: 12, color: '#92400E', background: '#FEF3C7', padding: '8px 12px', borderRadius: 8 }}>No number — try Gift Sender below</p>
                  )}
                </div>

                {/* Sender Backup */}
                {(senderName || senderPhone) && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ background: '#D1D5DB', color: '#374151', fontSize: 11, fontWeight: 700, width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Backup — Gift Sender</span>
                    </div>
                    <p style={{ fontSize: 15, fontWeight: 600, color: '#111827', marginBottom: 8 }}>{senderName}</p>
                    {senderPhone ? (
                      <ContactCallReveal phone={senderPhone} label="Gift Sender" driverName={currentUser.name} driverPhone={currentUser.phone || ''} />
                    ) : (
                      <p style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>No phone number on file</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ZONE 3: PROOF OF DELIVERY — Matching card style ── */}
        {!isCompleted && (
          <div style={{ padding: '0 16px', marginTop: 16 }}>
            <input type="file" accept="image/*" ref={fileRef} onChange={handlePhoto} className="hidden" />
            <input type="file" accept="image/*" capture="environment" ref={cameraRef} onChange={handlePhoto} className="hidden" />

            {/* POD Card */}
            <div style={{ background: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #E5E7EB' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>Proof of Delivery</p>

              {/* Photo tile — shows preview if set, two capture options when empty */}
              <div style={{ marginBottom: 16 }}>
                {photoData ? (
                  <button
                    onClick={() => cameraRef.current?.click()}
                    style={{ width: '100%', background: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB', minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', position: 'relative' }}
                  >
                    <img src={photoData} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }} alt="Photo" />
                    <div style={{ position: 'absolute', bottom: 8, left: 8, background: '#22C55E', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 9999 }}>✓ Photo</div>
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => cameraRef.current?.click()}
                      style={{ flex: 1, background: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB', minHeight: 64, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
                    >
                      <Camera size={18} style={{ color: '#6B7280' }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Take Photo</span>
                    </button>
                    <button
                      onClick={() => fileRef.current?.click()}
                      style={{ flex: 1, background: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB', minHeight: 64, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
                    >
                      <span style={{ fontSize: 16 }}>🖼️</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Upload</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Driver Note */}
              <textarea
                value={driverNote}
                onChange={e => setDriverNote(e.target.value)}
                placeholder="Add a note (e.g. left at door, with concierge)"
                style={{ width: '100%', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '12px', fontSize: 14, resize: 'none', minHeight: 60, outline: 'none' }}
              />
            </div>

            {/* Action buttons */}
            <button
              onClick={(photoData && !isSavingPOD) ? handleComplete : undefined}
              disabled={!photoData || isSavingPOD}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: 12,
                border: 'none',
                fontSize: 15,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: (photoData && !isSavingPOD) ? 'pointer' : 'not-allowed',
                marginBottom: 8,
                background: (photoData && !isSavingPOD) ? '#22C55E' : '#E5E7EB',
                color: (photoData && !isSavingPOD) ? 'white' : '#9CA3AF'
              }}
            >
              <CheckCircle2 size={20} /> {isSavingPOD ? 'Saving…' : photoData ? 'Mark Delivered' : 'Photo Required'}
            </button>

            <button
              onClick={() => setShowFailFlow(true)}
              style={{ width: '100%', padding: '12px', borderRadius: 12, background: 'transparent', border: '1px solid #E5E7EB', fontSize: 13, fontWeight: 600, color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
            >
              <XCircle size={16} /> Couldn't Deliver
            </button>


          </div>
        )}

        {/* ── COMPLETED: POD summary — Matching card style ── */}
        {isCompleted && (() => {
          const podPhoto = order.confirmationPhoto || (order as any).photo || null;
          const podSig = order.confirmationSignature || (order as any).signature || null;
          const podNotes = order.driverNotes || (order as any).notes || null;
          return (
          <div style={{ padding: '16px' }}>
            {/* Status card */}
            <div style={{ background: '#ffffff', borderRadius: 12, padding: 16, marginBottom: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #22C55E' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <StatusBadge status={order.status} />
                {order.completedAt && (
                  <span style={{ fontSize: 11, color: '#6B7280' }}>
                    {new Date(order.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {new Date(order.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {podNotes && <p style={{ fontSize: 13, fontStyle: 'italic', color: '#374151', background: '#F9FAFB', padding: '8px 12px', borderRadius: 8, marginTop: 8 }}>"{podNotes}"</p>}
              {order.driverId && <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>Delivered by {order.driverName || order.driverId}</p>}
            </div>

            {/* Photo tile — plus signature tile only when a historical signature exists */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div
                onClick={() => podPhoto && setLightboxPhoto(podPhoto)}
                style={{ flex: 1, background: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB', minHeight: 100, overflow: 'hidden', position: 'relative', cursor: podPhoto ? 'zoom-in' : 'default' }}
              >
                {podPhoto ? (
                  <>
                    <img src={podPhoto} style={{ width: '100%', height: '100%', objectFit: 'cover', minHeight: 100 }} alt="Photo" />
                    <div style={{ position: 'absolute', bottom: 6, left: 6, background: '#22C55E', color: 'white', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 9999 }}>✓ Photo</div>
                    <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.45)', color: 'white', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 9999 }}>🔍 Tap to zoom</div>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 100 }}>
                    <Camera size={20} style={{ color: '#D1D5DB', marginBottom: 4 }} />
                    <span style={{ fontSize: 11, color: '#9CA3AF' }}>No photo</span>
                  </div>
                )}
              </div>
              {podSig && (
                <div style={{ flex: 1, background: '#F9FAFB', borderRadius: 12, border: '1px solid #E5E7EB', minHeight: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
                  <img src={podSig} style={{ maxWidth: '100%', maxHeight: 60, objectFit: 'contain', marginBottom: 8 }} alt="Signature" />
                  <span style={{ background: '#DCFCE7', color: '#166534', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 9999 }}>✓ Signed</span>
                </div>
              )}
            </div>

            {/* Notification status */}
            {order.successNotificationSent && (
              <p style={{ fontSize: 12, color: '#166534', textAlign: 'center', marginBottom: 12 }}>✓ Delivery confirmation sent</p>
            )}
            {order.failureNotificationSent && (
              <p style={{ fontSize: 12, color: '#92400E', textAlign: 'center', marginBottom: 12 }}>✓ Customer notified of delay</p>
            )}

            {/* Admin actions */}

          </div>
          );
        })()}

        {/* ── PREVIOUS ATTEMPTS ── */}
        {order.attempts && order.attempts.length > 0 && (
          <div style={{ padding: '0 16px', marginBottom: 12 }}>
            <div style={{ background: '#ffffff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)', borderLeft: '3px solid #F59E0B', overflow: 'hidden' }}>
              <div style={{ background: '#F9FAFB', padding: '10px 16px', borderBottom: '1px solid #F3F4F6' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Previous Attempts ({order.attempts.length})</p>
              </div>
              {order.attempts.map((a, i) => (
                <div key={i} style={{ padding: '12px 16px', borderBottom: i < order.attempts.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{FAILURE_REASON_LABELS[a.reason as FailureReason] || a.reason}</p>
                  {a.notes && <p style={{ fontSize: 12, color: '#6B7280', fontStyle: 'italic', marginTop: 4 }}>"{a.notes}"</p>}
                  <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>{a.driverName || 'Driver'} · {formatDate(a.timestamp)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ADMIN SECTION — all controls with explicit SAVE ── */}
        {isAdmin && (
          <div className="mx-3 mt-3 bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-4 py-2 bg-stone-50 border-b border-stone-100 flex items-center justify-between">
              <p className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Admin Controls</p>
            </div>

            {/* Quick Controls Row: Status + Driver + Date */}
            <div className="px-4 py-3 border-b border-stone-100 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* Status */}
                <div>
                  <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-1">Status</p>
                  <select
                    value={pendingStatus}
                    onChange={(e) => setPendingStatus(e.target.value as any)}
                    className="w-full border rounded-lg px-2 py-2 text-xs font-bold outline-none focus:border-black transition-all bg-stone-50 border-stone-200"
                  >
                    {STATUSES_FOR_DROPDOWN.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                {/* Driver */}
                <div>
                  <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-1">Driver</p>
                  <select
                    value={pendingDriver}
                    onChange={(e) => setPendingDriver(e.target.value)}
                    className="w-full border rounded-lg px-2 py-2 text-xs font-bold outline-none focus:border-black bg-stone-50 border-stone-200"
                  >
                    <option value="">Select...</option>
                    {allUsers.filter(u => u.role === 'DRIVER' || u.role === 'ADMIN' || u.role === 'SUPER_ADMIN' || u.role === 'MANAGER').map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {/* Delivery Date */}
              <div>
                <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-1">Delivery Date</p>
                <input
                  type="date"
                  value={pendingDeliveryDate}
                  onChange={(e) => {
                    const selectedDate = new Date(e.target.value + 'T12:00:00');
                    const dayOfWeek = selectedDate.getDay();
                    // Block Saturday (6) only
                    if (dayOfWeek === 6) {
                      alert('We are closed on Saturdays. Please select a different day.');
                      return;
                    }
                    setPendingDeliveryDate(e.target.value);
                  }}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-bold outline-none focus:border-black bg-stone-50 border-stone-200"
                />
              </div>
              
              {/* SAVE BUTTON */}
              <button
                disabled={adminSaving}
                onClick={async () => {
                  setAdminSaving(true);
                  setAdminSaveResult(null);
                  const isManualOrder = (order as any).isManual;
                  let allSuccess = true;
                  
                  try {
                    // Save status if changed
                    if (pendingStatus !== order.status) {
                      const endpoint = isManualOrder 
                        ? `/api/manual-orders/${order.id}`
                        : `/api/orders/${order.id}/status`;
                      const resp = await fetch(endpoint, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: pendingStatus })
                      });
                      if (resp.ok) {
                        onUpdate(order.id, { status: pendingStatus as any });
                      } else {
                        allSuccess = false;
                      }
                    }
                    
                    // Save driver if changed
                    if (pendingDriver !== (order.driverId || '')) {
                      const newDriverUser = allUsers.find(u => u.id === pendingDriver);
                      if (pendingDriver && newDriverUser) {
                        const resp = await fetch(`/api/orders/${order.id}/assign`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ driverId: pendingDriver, driverName: newDriverUser.name })
                        });
                        if (resp.ok) {
                          onUpdate(order.id, { driverId: pendingDriver, driverName: newDriverUser.name });
                        } else {
                          allSuccess = false;
                        }
                      }
                    }
                    
                    // Save date if changed
                    if (pendingDeliveryDate !== (order.deliveryDate || '').split('T')[0]) {
                      const isManual = (order as any).isManual;
                      const endpoint = isManual 
                        ? `/api/manual-orders/${order.id}`
                        : `/api/orders/${order.id}/edit`;
                      const resp = await fetch(endpoint, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ deliveryDate: pendingDeliveryDate })
                      });
                      if (resp.ok) {
                        onUpdate(order.id, { deliveryDate: pendingDeliveryDate });
                      } else {
                        allSuccess = false;
                      }
                    }
                    
                    setAdminSaveResult(allSuccess ? 'saved' : 'error');
                    setTimeout(() => setAdminSaveResult(null), 3000);
                    
                    // If closed/cancelled, go back to list after brief delay
                    if (allSuccess && (pendingStatus === 'CLOSED' || pendingStatus === 'CANCELLED')) {
                      setTimeout(() => onBack(), 500);
                    }
                  } catch (err) {
                    console.error('Failed to save admin changes:', err);
                    setAdminSaveResult('error');
                    setTimeout(() => setAdminSaveResult(null), 3000);
                  } finally {
                    setAdminSaving(false);
                  }
                }}
                className={`w-full py-3 rounded-xl font-black text-sm uppercase tracking-wider transition-all ${
                  adminSaveResult === 'saved' 
                    ? 'bg-green-600 text-white' 
                    : adminSaveResult === 'error'
                    ? 'bg-red-500 text-white'
                    : 'bg-black text-white active:scale-[0.98]'
                }`}
              >
                {adminSaving ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </span>
                ) : adminSaveResult === 'saved' ? (
                  '✓ SAVED'
                ) : adminSaveResult === 'error' ? (
                  '⚠ FAILED — TRY AGAIN'
                ) : (
                  'SAVE CHANGES'
                )}
              </button>
              
              {(role === 'SUPER_ADMIN' || role === 'MANAGER') && (
                <div>
                  <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-1">Delivery Fee</p>
                  <input value={editFields.deliveryFee} onChange={e => setEditFields(p => ({ ...p, deliveryFee: e.target.value }))} onBlur={handleSaveContact} placeholder="$0.00" inputMode="decimal" className="w-full bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-amber-400" />
                </div>
              )}
            </div>

            {/* Edit Contact Info - Collapsible */}
            <div className="border-b border-stone-100">
              <button onClick={() => setEditingContact(e => !e)} className="w-full px-4 py-2 flex items-center justify-between bg-stone-50 active:bg-stone-100">
                <span className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Edit Contact & Address</span>
                <ChevronRight size={14} className={`text-stone-400 transition-transform ${editingContact ? 'rotate-90' : ''}`} />
              </button>
              {editingContact && (
                <div className="px-4 py-3 space-y-2">
                  <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Recipient</p>
                  <input value={editFields.recipientName} onChange={e => setEditFields(p => ({ ...p, recipientName: e.target.value }))} placeholder="Recipient name" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                  <input value={editFields.recipientPhone} onChange={e => setEditFields(p => ({ ...p, recipientPhone: e.target.value }))} placeholder="Recipient phone" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                  <input value={editFields.recipientEmail} onChange={e => setEditFields(p => ({ ...p, recipientEmail: e.target.value }))} placeholder="Recipient email" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                  <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2">Sender</p>
                  <input value={editFields.senderName} onChange={e => setEditFields(p => ({ ...p, senderName: e.target.value }))} placeholder="Sender name" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                  <input value={editFields.senderPhone} onChange={e => setEditFields(p => ({ ...p, senderPhone: e.target.value }))} placeholder="Sender phone" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                  <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2">Address</p>
                  <input value={editFields.street} onChange={e => setEditFields(p => ({ ...p, street: e.target.value }))} placeholder="Street address" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editFields.city} onChange={e => setEditFields(p => ({ ...p, city: e.target.value }))} placeholder="City" className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                    <input
                      value={editFields.zip}
                      onChange={e => {
                        const zip = e.target.value.replace(/\D/g,'').slice(0,5);
                        const autoFee = zip.length === 5 ? (DELIVERY_FEES[zip] ?? null) : null;
                        setEditFields(p => ({
                          ...p,
                          zip,
                          deliveryFee: autoFee !== null ? String(autoFee) : p.deliveryFee
                        }));
                      }}
                      placeholder="ZIP"
                      className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black"
                    />
                  </div>
                  {/* Fee preview — shows whenever ZIP is 5 digits */}
                  {editFields.zip.length === 5 && (() => {
                    const lookedUp = DELIVERY_FEES[editFields.zip] ?? null;
                    const current = parseFloat(editFields.deliveryFee) || 0;
                    const changed = lookedUp !== null && lookedUp !== (order.deliveryFee || 0);
                    return (
                      <div className={`rounded-xl px-3 py-2.5 flex items-center justify-between ${lookedUp !== null ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                        {lookedUp !== null ? (
                          <>
                            <span className="text-xs font-bold text-green-700">
                              {changed ? '✓ Fee auto-updated' : '✓ Fee confirmed'}
                            </span>
                            <span className="text-lg font-black text-green-700">${current.toFixed(2)}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs font-bold text-amber-700">ZIP not in table — enter fee manually</span>
                            <input
                              value={editFields.deliveryFee}
                              onChange={e => setEditFields(p => ({ ...p, deliveryFee: e.target.value }))}
                              placeholder="0.00"
                              inputMode="decimal"
                              className="w-20 text-right bg-white border border-amber-300 rounded-lg px-2 py-1 text-sm font-black outline-none"
                            />
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <button onClick={handleSaveContact} className="w-full py-3 bg-black text-white rounded-xl font-black uppercase text-xs mt-2">Save Changes</button>
                </div>
              )}
            </div>

            {/* Admin Notes */}
            <div className="px-4 py-3">
              {order.adminNotes && <div className="text-xs text-stone-600 mb-2 bg-stone-50 rounded-lg p-2 whitespace-pre-line">{order.adminNotes}</div>}
              <div className="flex gap-2">
                <input value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="Add admin note..." className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" />
                <button onClick={handleAddNote} className="px-4 py-2 bg-black text-white rounded-lg font-black text-xs uppercase">Add</button>
              </div>
            </div>
          </div>
        )}

        {/* ── NOTIFY PREVIEW MODAL ── */}
        {showNotifyPreview && (
          <div className="fixed inset-0 bg-black/80 z-[300] flex items-end">
            <div className="w-full bg-white rounded-t-[32px] p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="flex justify-between items-center">
                <h3 className="font-black uppercase text-sm">{showNotifyPreview === 'SUCCESS' ? 'Delivery Confirmation' : 'Delay Notification'}</h3>
                <button onClick={() => setShowNotifyPreview(null)}><X size={20} className="text-stone-400" /></button>
              </div>
              <div className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-xs text-stone-700 whitespace-pre-line leading-relaxed">{notifyPreviewText}</div>
              {notifyChannel && !notifySent && (
                <p className="text-[10px] font-bold text-stone-500 uppercase text-center">Will send via: {notifyChannel}</p>
              )}
              {notifySent ? (
                <div className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2">
                  ✓ Confirmation sent via {notifyChannel || 'email'}
                </div>
              ) : notifyError ? (
                <div className="space-y-2">
                  <div className="w-full py-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl font-bold text-xs text-center px-4">
                    ✗ {notifyError}
                  </div>
                  <button onClick={handleSend} disabled={isSending}
                    className="w-full py-4 bg-black text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                    {isSending ? 'Sending…' : <><Bell size={16} /> Try Again</>}
                  </button>
                </div>
              ) : (
                <button onClick={handleSend} disabled={isSending}
                  className="w-full py-4 bg-black text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                  {isSending ? 'Sending…' : <><Bell size={16} /> Send Now</>}
                </button>
              )}
            </div>
          </div>
        )}

      </div>

      {showFailFlow && (
        <FailedDeliveryFlow
          order={order}
          currentUser={currentUser}
          onSubmit={handleFailSubmit}
          onCancel={() => setShowFailFlow(false)}
        />
      )}

      {showReschedule && pendingFailure && (
        <RescheduleModal
          order={order}
          failureReason={pendingFailure.reason}
          driverNotes={pendingFailure.notes}
          photo={pendingFailure.photo}
          onAutoReschedule={handleAutoReschedule}
          onManualReschedule={handleManualReschedule}
        />
      )}

      {/* ── PHOTO LIGHTBOX ── */}
      {lightboxPhoto && (
        <div
          onClick={() => setLightboxPhoto(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.95)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            touchAction: 'pinch-zoom',
          }}
        >
          {/* Close hint */}
          <div style={{ position: 'absolute', top: 16, right: 16, color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 700 }}>
            ✕ Tap anywhere to close
          </div>
          <div style={{ position: 'absolute', bottom: 16, color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600 }}>
            Pinch to zoom
          </div>
          <img
            src={lightboxPhoto}
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '100%',
              maxHeight: '90vh',
              objectFit: 'contain',
              borderRadius: 8,
              touchAction: 'pinch-zoom',
              userSelect: 'none',
            }}
            alt="Proof of delivery"
          />
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ORDERS VIEW — Admin: full table. Driver: date-nav list.
// ─────────────────────────────────────────────────────────────────────────────

interface OrdersViewProps {
  deliveries: Delivery[];
  isAdmin: boolean;
  currentUser: UserAccount;
  allUsers: UserAccount[];
  isSameDayWindow: boolean;
  pendingCount: number;
  inTransitCount: number;
  deliveredTodayCount: number;
  onSelectOrder: (o: Delivery) => void;
  onUpdateOrder: (id: string, updates: Partial<Delivery>) => void;
}

const OrdersView: React.FC<OrdersViewProps> = ({
  deliveries, isAdmin, currentUser, allUsers, isSameDayWindow,
  pendingCount, inTransitCount, deliveredTodayCount, onSelectOrder, onUpdateOrder
}) => {
  const today = new Date().toISOString().split('T')[0];
  const [driverDate, setDriverDate] = useState(today);
  const [activeTab, setActiveTab] = useState<'active' | 'done'>('active');
  const [search, setSearch] = useState('');
  const [ordersDriverFilter, setOrdersDriverFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'OPEN'|'CLOSED'>('CLOSED');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rescheduleOrder, setRescheduleOrder] = useState<Delivery | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleSaved, setRescheduleSaved] = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);
  const [customOrder, setCustomOrder] = useState<string[]>([]); // manual sort order by order ID
  const [manualForm, setManualForm] = useState({
    recipientName: '', recipientPhone: '', recipientEmail: '',
    street: '', unit: '', city: '', zip: '',
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveryInstructions: '', itemDescription: '', orderTotal: '',
    giftSenderName: '', giftMessage: '',
    driverId: '', driverName: '',
  });
  const [manualSaving, setManualSaving] = useState(false);
  const [manualError, setManualError] = useState('');

  const shiftDate = (days: number) => {
    const d = new Date(driverDate + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDriverDate(d.toISOString().split('T')[0]);
  };

  const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  // Badge helper for 2nd attempt / needs attention
  const renderAttemptBadge = (order: Delivery) => {
    const is2nd = order.attemptNumber === 2;
    const needsAttention = is2nd && (order.status === DeliveryStatus.FAILED || order.status === DeliveryStatus.PENDING_RESCHEDULE);
    if (needsAttention) return <span className="inline-block ml-1 px-1.5 py-0.5 bg-red-100 text-red-700 text-[8px] font-black uppercase rounded">⚠ Needs Attention</span>;
    if (is2nd) return <span className="inline-block ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-black uppercase rounded">2nd Attempt</span>;
    return null;
  };

  // ── ADMIN VIEW ──
  if (isAdmin) {
    // Sort by delivery date DESC (most recent first), then order number DESC
    const sorted = [...deliveries].sort((a, b) => {
      const da = (a.deliveryDate || '0000').split('T')[0];
      const db = (b.deliveryDate || '0000').split('T')[0];
      if (da !== db) return db.localeCompare(da); // DESC - newest first
      return (b.orderNumber || '').localeCompare(a.orderNumber || ''); // DESC
    });
    const unassignedCount = deliveries.filter(d => !d.driverId || d.status === DeliveryStatus.PENDING).length;

    const adminToday = new Date().toISOString().split('T')[0];

    const CLOSED_STATUSES = [DeliveryStatus.DELIVERED, DeliveryStatus.CLOSED];
    const OPEN_STATUSES = [DeliveryStatus.PENDING, DeliveryStatus.SCHEDULED, DeliveryStatus.ASSIGNED, DeliveryStatus.IN_TRANSIT, DeliveryStatus.SECOND_ATTEMPT, DeliveryStatus.FAILED, DeliveryStatus.PENDING_RESCHEDULE];

    const uniqueOrderDrivers = [
      { id: 'ALL', name: 'All Drivers' },
      ...allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => ({ id: u.id, name: u.name }))
    ];

    // All orders — filtered by Open/Closed status toggle
    const todayFiltered = sorted;

    const filtered = todayFiltered.filter(d => {
      // Driver filter
      if (ordersDriverFilter !== 'ALL' && d.driverId !== ordersDriverFilter) return false;
      // Date range filter
      if (dateFrom || dateTo) {
        const orderDate = (d.deliveryDate || d.completedAt || '').split('T')[0];
        // If order has no date, skip the date filter (show it)
        if (orderDate) {
          if (dateFrom && orderDate < dateFrom) return false;
          if (dateTo && orderDate > dateTo) return false;
        }
      }
      // Status filter — always applies
      if (statusFilter === 'OPEN' && !OPEN_STATUSES.includes(d.status)) return false;
      if (statusFilter === 'CLOSED' && !CLOSED_STATUSES.includes(d.status)) return false;
      // Text search
      if (!search) return true;
      const q = search.toLowerCase();
      const statusLabel = STATUSES_FOR_DROPDOWN.find(s => s.value === d.status)?.label?.toLowerCase() || '';
      return (
        d.orderNumber?.toLowerCase().includes(q) ||
        d.customer?.name?.toLowerCase().includes(q) ||
        d.address?.street?.toLowerCase().includes(q) ||
        d.address?.city?.toLowerCase().includes(q) ||
        d.address?.zip?.toLowerCase().includes(q) ||
        d.giftReceiverName?.toLowerCase().includes(q) ||
        d.giftSenderName?.toLowerCase().includes(q) ||
        statusLabel.includes(q)
      );
    });

    return (<>
      <div className="flex flex-col h-full" style={{ background: '#FFFFFF' }}>
        {/* Search + Filters */}
        <div className="px-4 pt-3 pb-3 bg-white">
          {/* Search Input */}
          <div className="mb-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Search orders, names, addresses..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-stone-100 border-0 rounded-xl px-4 py-3 pl-10 text-sm font-medium outline-none focus:ring-2 focus:ring-black"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Driver filter */}
          <div className="flex gap-2 items-center">
            <select value={ordersDriverFilter} onChange={e => setOrdersDriverFilter(e.target.value)}
              style={{ background: '#F5F5F0', color: '#374151', border: 'none', borderRadius: 12, padding: '10px 14px', fontSize: 14, fontWeight: 600 }}>
              <option value="ALL">Viewing: All drivers</option>
              {uniqueOrderDrivers.filter(d => d.id !== 'ALL').map(d => (
                <option key={d.id} value={d.id}>Viewing: {d.name}</option>
              ))}
            </select>
            {/* Date Range Filter Toggle */}
            <button 
              onClick={() => setShowDateFilter(!showDateFilter)}
              className={`px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-1 ${dateFrom || dateTo ? 'bg-black text-white' : 'bg-stone-100 text-stone-600'}`}>
              <Calendar size={14} />
              {dateFrom || dateTo ? 'Dates ✓' : 'Dates'}
            </button>
          </div>

          {/* Date Range Picker */}
          {showDateFilter && (
            <div className="mt-3 p-3 bg-stone-50 rounded-xl border border-stone-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black uppercase text-stone-500">Filter by Date Range</p>
                {(dateFrom || dateTo) && (
                  <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] font-black text-red-500 uppercase">Clear</button>
                )}
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <p className="text-[9px] font-bold text-stone-400 mb-1">From</p>
                  <input 
                    type="date" 
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="w-full bg-white border border-stone-200 rounded-lg px-2 py-2 text-sm font-bold"
                  />
                </div>
                <div className="flex-1">
                  <p className="text-[9px] font-bold text-stone-400 mb-1">To</p>
                  <input 
                    type="date" 
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full bg-white border border-stone-200 rounded-lg px-2 py-2 text-sm font-bold"
                  />
                </div>
              </div>
              {/* Quick presets — only what makes sense for delivery scheduling */}
              <div className="flex gap-2 mt-2 flex-wrap">
                <button onClick={() => { setDateFrom(adminToday); setDateTo(adminToday); }} className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-[11px] font-bold">Today</button>
                <button onClick={() => { 
                  const tmrw = new Date(Date.now() + 86400000).toISOString().split('T')[0];
                  setDateFrom(tmrw); setDateTo(tmrw); 
                }} className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-[11px] font-bold">Tomorrow</button>
                <button onClick={() => { 
                  const y = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                  setDateFrom(y); setDateTo(y); 
                }} className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-[11px] font-bold">Yesterday</button>
              </div>
            </div>
          )}
        </div>

        {/* Compact spreadsheet-style rows — one line per order */}
        <div className="flex-1 overflow-y-auto" style={{ background: '#FFFFFF' }}>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Package size={32} className="text-stone-200 mb-2" />
              <p className="text-xs font-bold text-stone-300">No orders found</p>
            </div>
          ) : (() => {
            // Group by date
            const grouped: Record<string, typeof filtered> = {};
            filtered.forEach(order => {
              // For delivered/closed orders, group by completedAt (actual delivery date)
              // For open orders, group by deliveryDate (scheduled date)
              const isDoneOrder = order.status === 'DELIVERED' || order.status === 'CLOSED';
              const dateKey = isDoneOrder
                ? (order.completedAt || order.deliveryDate || 'unscheduled').split('T')[0]
                : (order.deliveryDate || 'unscheduled').split('T')[0];
              if (!grouped[dateKey]) grouped[dateKey] = [];
              grouped[dateKey].push(order);
            });
            
            return Object.entries(grouped).map(([dateKey, orders]) => {
              const d = dateKey !== 'unscheduled' ? new Date(dateKey + 'T12:00:00') : null;
              const isToday = dateKey === adminToday;
              const dayLabel = d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase() : 'UNSCHEDULED';
              
              return (
                <div key={dateKey}>
                  {/* Date header bar */}
                  <div style={{ background: '#F5F5F0', padding: '8px 12px', borderBottom: '1px solid #E5E7EB' }}>
                    <p style={{ color: '#6B7280', fontSize: 11, fontWeight: 700, letterSpacing: '0.5px' }}>
                      {isToday ? `TODAY` : dayLabel} <span style={{ color: '#9CA3AF', fontWeight: 500 }}>({orders.length})</span>
                    </p>
                  </div>
                  
                  {/* Column headers */}
                  <div style={{ display: 'flex', alignItems: 'center', padding: '5px 12px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                    <span style={{ width: 70, fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.5px', textTransform: 'uppercase', flexShrink: 0 }}>Order #</span>
                    <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Recipient</span>
                    <span style={{ width: 55, fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.5px', textTransform: 'uppercase', textAlign: 'center', flexShrink: 0 }}>Time</span>
                    <span style={{ width: 50, fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.5px', textTransform: 'uppercase', textAlign: 'center', flexShrink: 0 }}>Driver</span>
                    <span style={{ width: 70, fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.5px', textTransform: 'uppercase', textAlign: 'right', flexShrink: 0 }}>City</span>
                    <span style={{ width: 24, flexShrink: 0 }}></span>
                    <span style={{ width: 14, flexShrink: 0 }}></span>
                  </div>

                  {/* Compact rows — one line per order */}
                  <div>
                    {orders.map(order => {
                      const name = order.giftReceiverName || order.customer?.name || '—';
                      const truncatedName = name.length > 20 ? name.slice(0, 18) + '…' : name;
                      const cleanNum = (order.orderNumber || order.id).replace(/^#+/, '');
                      const isDone = order.status === 'DELIVERED' || order.status === 'CLOSED';
                      const isCancelled = order.status === 'CANCELLED';
                      const city = (order.address?.city || '').toUpperCase().slice(0, 12);
                      const completedTime = order.completedAt ? new Date(order.completedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—';
                      const driverInitial = order.driverName ? order.driverName.charAt(0).toUpperCase() : '—';
                      
                      return (
                        <div key={order.id}
                          onClick={() => onSelectOrder(order)}
                          style={{ 
                            display: 'flex',
                            alignItems: 'center',
                            padding: '10px 12px',
                            borderBottom: '1px solid #F3F4F6',
                            cursor: 'pointer',
                            background: isCancelled ? '#FEF2F2' : '#FFFFFF'
                          }}>
                          {/* Order # */}
                          <span style={{ width: 70, fontSize: 11, fontWeight: 600, color: '#6B7280', flexShrink: 0 }}>#{cleanNum}</span>
                          {/* Name - takes remaining space */}
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{truncatedName}</span>
                          {/* Completed Time */}
                          <span style={{ width: 55, fontSize: 10, fontWeight: 600, color: isDone ? '#22C55E' : '#9CA3AF', textAlign: 'center', flexShrink: 0 }}>{isDone ? completedTime : '—'}</span>
                          {/* Driver initial */}
                          <span style={{ width: 50, fontSize: 11, fontWeight: 700, color: '#6B7280', textAlign: 'center', flexShrink: 0 }}>{driverInitial}</span>
                          {/* City */}
                          <span style={{ width: 70, fontSize: 11, fontWeight: 700, color: '#374151', textAlign: 'right', flexShrink: 0 }}>{city}</span>
                          {/* Status indicator */}
                          <span style={{ width: 24, textAlign: 'center', flexShrink: 0 }}>
                            {isDone && <span style={{ color: '#22C55E', fontSize: 14 }}>✓</span>}
                            {isCancelled && <span style={{ color: '#EF4444', fontSize: 12 }}>✕</span>}
                          </span>
                          {/* Chevron */}
                          <ChevronRight size={14} style={{ color: '#D1D5DB', flexShrink: 0 }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* ── RESCHEDULE MODAL ── */}
      {rescheduleOrder && (
        <div className="fixed inset-0 z-[998] bg-black/50 flex items-end justify-center" onClick={() => setRescheduleOrder(null)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
            <p className="text-center text-sm font-black uppercase text-stone-500 tracking-widest">Reschedule Delivery</p>
            <p className="text-center text-xs text-stone-400">Order #{rescheduleOrder.orderNumber?.replace(/^#+/, '') || rescheduleOrder.id} — {rescheduleOrder.giftReceiverName || rescheduleOrder.customer?.name}</p>
            <input type="date" value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)}
              className="w-full border-2 border-stone-300 rounded-xl px-4 py-3 text-lg font-bold text-center focus:border-amber-500 focus:outline-none" />
            {rescheduleDate && rescheduleDate !== rescheduleOrder.deliveryDate && (
              <p className="text-center text-sm font-bold text-amber-700">
                → {new Date(rescheduleDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            )}
            <button onClick={async () => {
              onUpdateOrder(rescheduleOrder.id, { deliveryDate: rescheduleDate });
              const isManualReschedule = (rescheduleOrder as any).isManual;
              if (isManualReschedule) {
                await fetch(`/api/manual-orders/${rescheduleOrder.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryDate: rescheduleDate }) });
              } else {
                await fetch(`/api/orders/${rescheduleOrder.id}/edit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryDate: rescheduleDate }) });
              }
              setRescheduleOrder(null);
              setRescheduleSaved(true);
              setTimeout(() => setRescheduleSaved(false), 3000);
            }} disabled={!rescheduleDate || rescheduleDate === rescheduleOrder.deliveryDate}
              className={`w-full py-4 rounded-2xl font-black text-base active:scale-95 ${!rescheduleDate || rescheduleDate === rescheduleOrder.deliveryDate ? 'bg-stone-200 text-stone-400' : 'bg-green-600 text-white'}`}>
              ✓ Confirm New Date
            </button>
            <button onClick={() => setRescheduleOrder(null)}
              className="w-full py-3 text-stone-400 font-bold text-sm active:scale-95">
              Cancel
            </button>
          </div>
        </div>
      )}
      {rescheduleSaved && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[999] bg-green-600 text-white px-6 py-3 rounded-2xl shadow-lg font-black text-sm flex items-center gap-2 animate-bounce">
          ✓ Delivery rescheduled successfully
        </div>
      )}

      {/* ── MANUAL DELIVERY MODAL ── */}
      {showAddManual && (
        <div className="fixed inset-0 z-[999] bg-black/60 flex items-end justify-center" onClick={() => setShowAddManual(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl pb-10 flex flex-col" style={{ maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-stone-100 shrink-0">
              <p className="font-black text-base uppercase tracking-wide">Add Delivery Manually</p>
              <button onClick={() => setShowAddManual(false)} className="w-8 h-8 flex items-center justify-center bg-stone-100 rounded-full text-stone-500 font-black"><X size={14} /></button>
            </div>
            {/* Scrollable form */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

              {/* Section: Recipient */}
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Recipient Info</p>
              <input value={manualForm.recipientName} onChange={e => setManualForm(f => ({ ...f, recipientName: e.target.value }))}
                placeholder="Recipient Name *" className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              <input value={manualForm.recipientPhone} onChange={e => setManualForm(f => ({ ...f, recipientPhone: e.target.value }))}
                placeholder="Recipient Phone" type="tel" className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />

              {/* Section: Address */}
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2">Delivery Address</p>
              <input value={manualForm.street} onChange={e => setManualForm(f => ({ ...f, street: e.target.value }))}
                placeholder="Street Address *" className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              <input value={manualForm.unit} onChange={e => setManualForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="Unit / Apt / Suite" className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              <div className="flex gap-2">
                <input value={manualForm.city} onChange={e => setManualForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="City *" className="flex-1 border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
                <input value={manualForm.zip} onChange={e => setManualForm(f => ({ ...f, zip: e.target.value }))}
                  placeholder="ZIP *" maxLength={5} className="w-24 border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              </div>

              {/* Section: Delivery */}
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2">Delivery Details</p>
              <div>
                <p className="text-[10px] font-black text-stone-500 mb-1">Delivery Date *</p>
                <input type="date" value={manualForm.deliveryDate} onChange={e => setManualForm(f => ({ ...f, deliveryDate: e.target.value }))}
                  className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              </div>
              <textarea value={manualForm.deliveryInstructions} onChange={e => setManualForm(f => ({ ...f, deliveryInstructions: e.target.value }))}
                placeholder="Delivery Instructions (gate code, call before, etc.)" rows={2}
                className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black resize-none" />

              {/* Section: Order */}
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2">Order Info</p>
              <textarea value={manualForm.itemDescription} onChange={e => setManualForm(f => ({ ...f, itemDescription: e.target.value }))}
                placeholder="Item Description (e.g. 3 Gift Baskets — Shiva, Dairy) *" rows={2}
                className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black resize-none" />
              <input value={manualForm.orderTotal} onChange={e => setManualForm(f => ({ ...f, orderTotal: e.target.value }))}
                placeholder="Order Total (e.g. 850)" type="number" className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />

              {/* Section: Sender & Message */}
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2">Sender & Gift Message</p>
              <input value={manualForm.giftSenderName} onChange={e => setManualForm(f => ({ ...f, giftSenderName: e.target.value }))}
                placeholder="Gift Sender Name" className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              <textarea value={manualForm.giftMessage} onChange={e => setManualForm(f => ({ ...f, giftMessage: e.target.value }))}
                placeholder="Gift Message" rows={2}
                className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black resize-none" />

              {/* Section: Driver */}
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2">Assign Driver</p>
              <select value={manualForm.driverId} onChange={e => {
                const u = allUsers.find(u => u.id === e.target.value);
                setManualForm(f => ({ ...f, driverId: e.target.value, driverName: u?.name || '' }));
              }} className="w-full border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black bg-white">
                <option value="">— Select Driver —</option>
                {allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>

              {manualError && <p className="text-xs font-black text-red-600 text-center">{manualError}</p>}
            </div>

            {/* Save button */}
            <div className="px-5 pt-3 shrink-0 border-t border-stone-100">
              <button
                disabled={manualSaving}
                onClick={async () => {
                  setManualError('');
                  if (!manualForm.recipientName.trim()) { setManualError('Recipient name is required.'); return; }
                  if (!manualForm.street.trim()) { setManualError('Street address is required.'); return; }
                  if (!manualForm.city.trim()) { setManualError('City is required.'); return; }
                  if (!manualForm.zip.trim()) { setManualError('ZIP code is required.'); return; }
                  if (!manualForm.itemDescription.trim()) { setManualError('Item description is required.'); return; }
                  if (!manualForm.deliveryDate) { setManualError('Delivery date is required.'); return; }
                  setManualSaving(true);
                  try {
                    const resp = await fetch('/api/manual-orders', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        ...manualForm,
                        driverId: manualForm.driverId || 'manager_1',
                        driverName: manualForm.driverName || 'Katie',
                      }),
                    });
                    const data = await resp.json();
                    if (!data.success) throw new Error(data.error || 'Save failed');
                    // Close modal and show success — user taps refresh to see new order
                    setShowAddManual(false);
                    setManualSaving(false);
                    alert('✓ Delivery saved! Tap the refresh button (↺) to see it in the list.');
                  } catch (e: any) {
                    setManualError(e.message || 'Something went wrong. Try again.');
                    setManualSaving(false);
                  }
                }}
                className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${manualSaving ? 'bg-stone-300 text-stone-500' : 'bg-black text-white'}`}
              >
                {manualSaving ? 'Saving...' : '✓ Save Delivery'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>);
  }

  // ── DRIVER VIEW ──
  const myOrders = deliveries.filter(d => {
    const dd = (d.deliveryDate || today).split('T')[0];
    // Strict: only show orders assigned to THIS driver
    return dd === driverDate && d.driverId === currentUser.id;
  });
  const active = myOrders.filter(d => d.status !== DeliveryStatus.DELIVERED && d.status !== DeliveryStatus.CLOSED);
  const done = myOrders.filter(d => d.status === DeliveryStatus.DELIVERED || d.status === DeliveryStatus.CLOSED);
  
  // Apply custom sort order to active deliveries
  const sortedActive = customOrder.length > 0
    ? [...active].sort((a, b) => {
        const aIdx = customOrder.indexOf(a.id);
        const bIdx = customOrder.indexOf(b.id);
        if (aIdx === -1 && bIdx === -1) return 0;
        if (aIdx === -1) return 1;
        if (bIdx === -1) return -1;
        return aIdx - bIdx;
      })
    : active;
  
  const shown = activeTab === 'active' ? sortedActive : done;
  
  // Move order up/down in the list
  const moveOrder = (orderId: string, direction: 'up' | 'down') => {
    const currentList = customOrder.length > 0 ? customOrder : active.map(o => o.id);
    const idx = currentList.indexOf(orderId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === currentList.length - 1) return;
    const newList = [...currentList];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newList[idx], newList[swapIdx]] = [newList[swapIdx], newList[idx]];
    setCustomOrder(newList);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Date navigator */}
      <div className="bg-white border-b border-stone-100 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => shiftDate(-1)} className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center active:scale-95">
            <ChevronLeft size={20} />
          </button>
          <div className="text-center">
            <p className="text-lg font-black text-stone-900">{fmtDate(driverDate)}</p>
            {driverDate === today && <p className="text-[10px] font-black text-black uppercase tracking-widest">TODAY</p>}
          </div>
          <button onClick={() => shiftDate(1)} className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center active:scale-95">
            <ChevronRight size={20} />
          </button>
        </div>
        {/* Active / Done tabs */}
        <div className="flex rounded-xl overflow-hidden border border-stone-200">
          <button onClick={() => setActiveTab('active')}
            className={`flex-1 py-2 font-black text-xs uppercase transition-all ${activeTab === 'active' ? 'bg-black text-white' : 'bg-white text-stone-400'}`}>
            Active ({active.length})
          </button>
          <button onClick={() => setActiveTab('done')}
            className={`flex-1 py-2 font-black text-xs uppercase transition-all ${activeTab === 'done' ? 'bg-black text-white' : 'bg-white text-stone-400'}`}>
            Done ({done.length}/{myOrders.length})
          </button>
        </div>
      </div>

      {/* Driver order list */}
      <div className="flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Package size={36} className="text-stone-200 mb-3" />
            <p className="text-xs font-black uppercase text-stone-300">
              {activeTab === 'active' ? 'No active deliveries' : 'None completed yet'}
            </p>
          </div>
        ) : shown.map((order, idx) => {
          const statusDot: Record<string, string> = {
            ASSIGNED: 'bg-blue-500', IN_TRANSIT: 'bg-black', DELIVERED: 'bg-green-500',
            FAILED: 'bg-red-500', SECOND_ATTEMPT: 'bg-stone-700',
          };
          const dot = statusDot[order.status] || 'bg-stone-400';
          const statusBg: Record<string,string> = { PENDING:'bg-stone-700', ASSIGNED:'bg-stone-600', IN_TRANSIT:'bg-black', DELIVERED:'bg-stone-200', FAILED:'bg-red-600', SECOND_ATTEMPT:'bg-stone-600', PENDING_RESCHEDULE:'bg-amber-500' };
          const cardBg = statusBg[order.status] || 'bg-stone-700';
          const labelText = STATUS_CONFIG[order.status]?.label || order.status;
          const isDelivered = order.status === DeliveryStatus.DELIVERED;
          return (
            <div key={order.id}
              onClick={() => onSelectOrder(order)}
              className={`mx-3 mb-2 rounded-xl border border-stone-200 overflow-hidden transition-all cursor-pointer active:scale-[0.98] ${isDelivered ? 'bg-[#F8F9FA]' : 'bg-white'}`}>
              {/* Status bar with BIG order number */}
              <div className={`${cardBg} px-3 py-2 flex items-center justify-between`}>
                <span className={`text-[10px] font-black uppercase tracking-widest ${isDelivered ? 'text-stone-500' : 'text-white'}`}>{labelText}</span>
                <span className={`text-xl font-black ${isDelivered ? 'text-stone-500' : 'text-white'}`}>#{order.orderNumber?.replace(/^#+/, '') || order.id}</span>
              </div>
              <div className="px-3 py-2.5 flex items-center gap-2">
                {/* Stop number + move buttons (active only) */}
                {activeTab === 'active' ? (
                  <div className="flex flex-col items-center gap-0.5 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); moveOrder(order.id, 'up'); }}
                      disabled={idx === 0}
                      className={`w-7 h-6 flex items-center justify-center rounded ${idx === 0 ? 'text-stone-200' : 'text-stone-500 bg-stone-100 active:bg-stone-200'}`}
                    >
                      <ChevronUp size={16} />
                    </button>
                    <span className="text-lg font-black text-stone-400 w-7 text-center">{idx + 1}</span>
                    <button
                      onClick={e => { e.stopPropagation(); moveOrder(order.id, 'down'); }}
                      disabled={idx === shown.length - 1}
                      className={`w-7 h-6 flex items-center justify-center rounded ${idx === shown.length - 1 ? 'text-stone-200' : 'text-stone-500 bg-stone-100 active:bg-stone-200'}`}
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                ) : (
                  <span className="text-2xl font-black text-stone-200 w-7 shrink-0 text-center">{idx + 1}</span>
                )}
                <div className="flex-1 min-w-0">
                  {/* RECIPIENT NAME — first and largest */}
                  <p className="text-base font-black text-stone-900 leading-tight">{order.giftReceiverName || order.customer?.name}</p>
                  {renderAttemptBadge(order)}
                  {/* Address — tappable Google Maps link */}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.address?.street || ''}, ${order.address?.city || ''}, FL ${order.address?.zip || ''}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-sm font-semibold text-blue-600 underline truncate block"
                  >
                    📍 {order.address?.street}, {order.address?.city}
                  </a>
                  {order.items?.[0] && (
                    <p className="text-xs text-stone-400 truncate">{order.items[0].name} — ${(order.items[0].price * order.items[0].quantity).toFixed(2)}</p>
                  )}
                  {order.deliveryInstructions && (
                    <div className="flex items-center gap-1.5 bg-amber-400 rounded-lg px-2.5 py-1.5 mt-1">
                      <AlertTriangle size={12} className="text-amber-900 shrink-0" />
                      <p className="text-xs font-black text-amber-950 leading-snug">{order.deliveryInstructions}</p>
                    </div>
                  )}
                </div>
                <ChevronRight size={16} className="text-stone-300 shrink-0 " />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE VIEW
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE MAP PANEL — Leaflet + OpenStreetMap (free)
// ─────────────────────────────────────────────────────────────────────────────

declare const L: any; // Leaflet loaded via CDN

const RouteMapPanel: React.FC<{
  stops: { id: string; lat: number; lng: number; name: string; address: string; orderNumber: string; stopNumber: number }[];
  driverLat: number;
  driverLng: number;
  onClose: () => void;
  onStartNav: (app: 'waze' | 'google') => void;
  totalDistance: number;
  onReorder: (newStops: { id: string; lat: number; lng: number; name: string; address: string; orderNumber: string; stopNumber: number }[]) => void;
}> = ({ stops, driverLat, driverLng, onClose, onStartNav, totalDistance, onReorder }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  
  // Drag-and-drop state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const touchStartY = useRef<number>(0);
  const touchCurrentIdx = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapRef.current || typeof L === 'undefined') return;
    if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; }

    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([driverLat, driverLng], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);

    // Driver marker (blue)
    const driverIcon = L.divIcon({
      html: '<div style="width:28px;height:28px;background:#2563eb;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M12 2L19 21l-7-4-7 4z"/></svg></div>',
      iconSize: [28, 28], iconAnchor: [14, 14], className: ''
    });
    L.marker([driverLat, driverLng], { icon: driverIcon }).addTo(map).bindPopup('<b>You are here</b>');

    // Stop markers (numbered)
    // Only show stops with valid Florida-area coordinates on the map
    const validStops = stops.filter(s => s.lat > 24 && s.lat < 31 && s.lng > -88 && s.lng < -79);
    
    const allPoints: [number, number][] = [[driverLat, driverLng]];
    validStops.forEach(s => {
      const stopIcon = L.divIcon({
        html: `<div style="width:30px;height:30px;background:#111;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:13px;font-family:system-ui">${s.stopNumber}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15], className: ''
      });
      L.marker([s.lat, s.lng], { icon: stopIcon }).addTo(map)
        .bindPopup(`<b>Stop ${s.stopNumber}: #${s.orderNumber}</b><br/>${s.name}<br/><span style="font-size:11px;color:#666">${s.address}</span>`);
      allPoints.push([s.lat, s.lng]);
    });

    // Draw route line
    if (allPoints.length > 1) {
      L.polyline(allPoints, { color: '#111', weight: 3, opacity: 0.7, dashArray: '8,8' }).addTo(map);
    }

    // Fit bounds
    if (allPoints.length > 1) {
      map.fitBounds(allPoints, { padding: [40, 40] });
    }

    mapInstance.current = map;
    setTimeout(() => map.invalidateSize(), 100);

    return () => { if (mapInstance.current) { mapInstance.current.remove(); mapInstance.current = null; } };
  }, [stops, driverLat, driverLng]);

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex flex-col">
      {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center justify-between border-b border-stone-200 safe-top">
        <div>
          <p className="font-black text-sm uppercase">Optimized Route</p>
          <p className="text-[10px] text-stone-500 font-bold">{stops.length} stops • ~{totalDistance} mi total</p>
        </div>
        <button onClick={onClose} className="px-4 py-2 bg-black text-white rounded-xl font-black text-sm active:scale-95">
          ✕ Close
        </button>
      </div>

      {/* Map */}
      <div ref={mapRef} className="flex-1" style={{ minHeight: 200 }} />

      {/* Stop list - drag and drop */}
      <div ref={listRef} className="bg-white max-h-[35vh] overflow-y-auto border-t border-stone-200">
        <div className="px-4 py-1.5 bg-stone-50 border-b border-stone-200">
          <p className="text-[10px] font-black text-stone-400 uppercase tracking-wide">Hold & drag to reorder stops</p>
        </div>
        {stops.map((s, idx) => (
          <div
            key={s.id}
            draggable
            onDragStart={(e) => {
              setDragIdx(idx);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(idx));
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIdx !== null && dragIdx !== idx) {
                setDragOverIdx(idx);
              }
            }}
            onDragLeave={() => setDragOverIdx(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIdx !== null && dragIdx !== idx) {
                const next = [...stops];
                const [dragged] = next.splice(dragIdx, 1);
                next.splice(idx, 0, dragged);
                onReorder(next.map((stop, i) => ({ ...stop, stopNumber: i + 1 })));
              }
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            onTouchStart={(e) => {
              touchStartY.current = e.touches[0].clientY;
              touchCurrentIdx.current = idx;
              setDragIdx(idx);
            }}
            onTouchMove={(e) => {
              if (touchCurrentIdx.current === null || !listRef.current) return;
              const touch = e.touches[0];
              const elements = listRef.current.querySelectorAll('[data-stop-idx]');
              elements.forEach((el, i) => {
                const rect = el.getBoundingClientRect();
                if (touch.clientY >= rect.top && touch.clientY <= rect.bottom && i !== touchCurrentIdx.current) {
                  setDragOverIdx(i);
                }
              });
            }}
            onTouchEnd={() => {
              if (touchCurrentIdx.current !== null && dragOverIdx !== null && touchCurrentIdx.current !== dragOverIdx) {
                const next = [...stops];
                const [dragged] = next.splice(touchCurrentIdx.current, 1);
                next.splice(dragOverIdx, 0, dragged);
                onReorder(next.map((stop, i) => ({ ...stop, stopNumber: i + 1 })));
              }
              setDragIdx(null);
              setDragOverIdx(null);
              touchCurrentIdx.current = null;
            }}
            data-stop-idx={idx}
            className={`flex items-center gap-3 px-4 py-3 border-b border-stone-100 cursor-grab active:cursor-grabbing select-none transition-all ${
              s.lat === 0 ? 'bg-amber-50' : ''
            } ${
              dragIdx === idx ? 'opacity-50 scale-95 bg-stone-100' : ''
            } ${
              dragOverIdx === idx ? 'border-t-4 border-t-blue-500' : ''
            }`}
          >
            {/* Drag handle */}
            <div className="flex flex-col gap-0.5 text-stone-300 mr-1">
              <div className="w-4 h-0.5 bg-current rounded" />
              <div className="w-4 h-0.5 bg-current rounded" />
              <div className="w-4 h-0.5 bg-current rounded" />
            </div>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${s.lat === 0 ? 'bg-amber-500' : 'bg-black'}`}>
              <span className="text-white font-black text-xs">{s.lat === 0 ? '?' : s.stopNumber}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black text-stone-900 truncate">{s.name}</p>
              <p className={`text-[10px] truncate ${s.lat === 0 ? 'text-amber-600 font-bold' : 'text-stone-400'}`}>{s.address}</p>
            </div>
            <p className="text-[10px] font-black text-stone-400">#{s.orderNumber?.replace(/^#+/, '')}</p>
          </div>
        ))}
      </div>

      {/* Navigation buttons */}
      <div className="bg-white px-4 py-3 border-t border-stone-200 safe-bottom">
        <div className="flex gap-2 mb-2">
          <button onClick={() => onStartNav('waze')}
            className="flex-1 py-3.5 bg-[#33ccff] text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95">
            <Navigation size={16} /> Waze
          </button>
          <button onClick={() => onStartNav('google')}
            className="flex-1 py-3.5 bg-[#4285F4] text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95">
            <MapIcon size={16} /> Google Maps
          </button>
        </div>
        <button onClick={onClose}
          className="w-full py-3 bg-stone-200 text-stone-700 rounded-2xl font-black uppercase text-sm active:scale-95">
          ← Back to Deliveries
        </button>
      </div>
    </div>
  );
};

// Sub-component for admin action row on each delivery card
// Must be a proper component (not inline) so React hooks rules are satisfied
const OrderAdminRow: React.FC<{
  order: Delivery;
  allUsers: UserAccount[];
  activeDrivers: UserAccount[];
  onUpdateOrder: (id: string, updates: Partial<Delivery>) => void;
}> = ({ order, allUsers, activeDrivers, onUpdateOrder }) => {
  const [localDate, setLocalDate] = useState(order.deliveryDate || '');
  const [showDateInput, setShowDateInput] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  return (
    <div className="px-3 pb-3 pt-0 space-y-1.5 bg-inherit" onClick={e => e.stopPropagation()}>
      {/* Save confirmation toast */}
      {saveToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-green-600 text-white px-5 py-3 rounded-xl font-black text-sm shadow-xl flex items-center gap-2 animate-pulse">
          ✓ {saveToast}
        </div>
      )}
      {/* Driver dropdown */}
      <div className="flex items-center gap-2">
        <Users size={13} className="text-stone-400 shrink-0" />
        <select
          value={order.driverId || ''}
          onChange={async e => {
            const u = allUsers.find(u => u.id === e.target.value);
            if (!u) return;
            onUpdateOrder(order.id, { driverId: u.id, driverName: u.name });
            const isManual = (order as any).isManual;
            const resp = await fetch(isManual ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/assign`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ driverId: u.id, driverName: u.name })
            });
            if (resp.ok) {
              setSaveToast(`Assigned to ${u.name}`);
              setTimeout(() => setSaveToast(null), 2000);
            }
          }}
          className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-2 py-2 text-sm font-black outline-none text-stone-700 focus:border-black"
        >
          <option value="">— Assign Driver —</option>
          {activeDrivers.map(u => (
            <option key={u.id} value={u.id}>{u.name}{order.driverId === u.id ? ' ✓' : ''}</option>
          ))}
        </select>
      </div>
      {/* Date change */}
      {!showDateInput ? (
        <button
          onClick={() => setShowDateInput(true)}
          className="w-full text-left flex items-center gap-2 px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-lg"
        >
          <Calendar size={13} className="text-stone-400 shrink-0" />
          <span className="text-sm font-black text-stone-600">
            📅 {order.deliveryDate ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) : 'No date set'}
          </span>
          <span className="ml-auto text-[10px] font-black text-blue-600 uppercase">Change</span>
        </button>
      ) : (
        <div className="flex gap-2 items-center">
          <Calendar size={13} className="text-stone-400 shrink-0" />
          <input type="date" value={localDate} onChange={e => setLocalDate(e.target.value)}
            className="flex-1 bg-white border-2 border-blue-400 rounded-lg px-2 py-1.5 text-sm font-black outline-none" autoFocus />
          <button
            onClick={async () => {
              if (!localDate) return;
              onUpdateOrder(order.id, { deliveryDate: localDate });
              const isManual = (order as any).isManual;
              const resp = await fetch(isManual ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/edit`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deliveryDate: localDate })
              });
              if (resp.ok) {
                setSaveToast(`Date saved: ${new Date(localDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })}`);
                setTimeout(() => setSaveToast(null), 2000);
              }
              setShowDateInput(false);
            }}
            className="px-3 py-1.5 bg-green-600 text-white rounded-lg font-black text-xs"
          >✓</button>
          <button onClick={() => setShowDateInput(false)} className="px-2 py-1.5 bg-stone-200 rounded-lg font-black text-xs">✕</button>
        </div>
      )}
    </div>
  );
};

const ScheduleView: React.FC<{
  deliveries: Delivery[];
  role: AppRole;
  currentUserId: string;
  allUsers: UserAccount[];
  onSelectOrder: (order: Delivery) => void;
  onUpdateOrder: (id: string, updates: Partial<Delivery>) => void;
}> = ({ deliveries, role, currentUserId, allUsers, onSelectOrder, onUpdateOrder }) => {
  const isAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  const [search, setSearch] = useState('');
  const [driverFilter, setDriverFilter] = useState('ALL');
  const [showPlanRoute, setShowPlanRoute] = useState(false);
  const [stopNumbers, setStopNumbers] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<'OPEN'|'DONE'|'ALL'>('OPEN');
  const [sortBy, setSortBy] = useState<'date'|'city'|'zip'|'name'|'driver'>('date');
  const [customOrder, setCustomOrder] = useState<string[]>([]); // manual sort by order ID
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Route optimization state
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeStatus, setRouteStatus] = useState('');
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [routeStops, setRouteStops] = useState<any[]>([]);
  const [routeTotalDist, setRouteTotalDist] = useState(0);
  const [driverLat, setDriverLat] = useState(25.946);
  const [driverLng, setDriverLng] = useState(-80.155);
  const [routeSaved, setRouteSaved] = useState(false);
  const [dragOrderId, setDragOrderId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [routeSavedMsg, setRouteSavedMsg] = useState('');
  const [filterToast, setFilterToast] = useState('');
  const planRouteListRef = useRef<HTMLDivElement>(null);
  const touchDragId = useRef<string | null>(null);

  // Helper to show filter feedback
  const showFilterToast = (msg: string) => {
    setFilterToast(msg);
    setTimeout(() => setFilterToast(''), 1500);
  };

  const activeDrivers = useMemo(() =>
    allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive),
    [allUsers]
  );

  const OPEN_STATUSES = ['PENDING','ASSIGNED','IN_TRANSIT','SCHEDULED','SECOND_ATTEMPT','FAILED','PENDING_RESCHEDULE'];
  const DONE_STATUSES = ['DELIVERED','CLOSED','CANCELLED'];

  // Filter deliveries
  const filtered = useMemo(() => {
    return deliveries.filter(d => {
      // Driver filter - STRICT isolation for non-admins
      if (!isAdmin) {
        // Drivers only see orders assigned to THEM
        if (d.driverId !== currentUserId) return false;
      } else if (driverFilter !== 'ALL') {
        if (d.driverId !== driverFilter) return false;
      }
      // Date range filter
      if (dateFrom || dateTo) {
        const orderDate = (d.deliveryDate || d.completedAt || '').split('T')[0];
        // If order has no date, skip the date filter (show it)
        if (orderDate) {
          if (dateFrom && orderDate < dateFrom) return false;
          if (dateTo && orderDate > dateTo) return false;
        }
      }
      // Status filter — skip when date range is active (show all statuses)
      if (!(dateFrom || dateTo)) {
        if (statusFilter === 'OPEN' && !OPEN_STATUSES.includes(d.status)) return false;
        if (statusFilter === 'DONE' && !DONE_STATUSES.includes(d.status)) return false;
      }
      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          (d.giftReceiverName || '').toLowerCase().includes(q) ||
          (d.customer?.name || '').toLowerCase().includes(q) ||
          (d.orderNumber || '').toLowerCase().includes(q) ||
          (d.address?.city || '').toLowerCase().includes(q) ||
          (d.address?.zip || '').toLowerCase().includes(q) ||
          (d.address?.street || '').toLowerCase().includes(q) ||
          (d.driverName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [deliveries, driverFilter, statusFilter, search, isAdmin, currentUserId, dateFrom, dateTo]);

  // Group by date, sorted ascending
  const grouped = useMemo(() => {
    const map: Record<string, Delivery[]> = {};
    // Only include today as first group when NOT filtering by date range
    const isDateFiltered = dateFrom || dateTo;
    if (!isDateFiltered) {
      map[todayStr] = [];
    }
    filtered.forEach(d => {
      const key = (d.deliveryDate || 'unscheduled').split('T')[0];
      if (!map[key]) map[key] = [];
      map[key].push(d);
    });
    // Sort within each date group - custom order takes priority, then sortBy
    Object.values(map).forEach(group => {
      group.sort((a, b) => {
        // If custom order exists, use it first
        if (customOrder.length > 0) {
          const aIdx = customOrder.indexOf(a.id);
          const bIdx = customOrder.indexOf(b.id);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
          if (aIdx !== -1) return -1;
          if (bIdx !== -1) return 1;
        }
        // Fallback to sortBy
        if (sortBy === 'city') return (a.address?.city || '').localeCompare(b.address?.city || '');
        if (sortBy === 'zip') return (a.address?.zip || '').localeCompare(b.address?.zip || '');
        if (sortBy === 'name') return (a.giftReceiverName || a.customer?.name || '').localeCompare(b.giftReceiverName || b.customer?.name || '');
        if (sortBy === 'driver') return (a.driverName || '').localeCompare(b.driverName || '');
        // default: date order (by order number)
        return (a.orderNumber || '').localeCompare(b.orderNumber || '');
      });
    });
    // Sort dates: today first (if not filtering), then chronological, unscheduled last
    // Filter out empty date groups (e.g., TODAY with no orders)
    return Object.entries(map).filter(([, orders]) => orders.length > 0).sort(([a], [b]) => {
      if (a === 'unscheduled') return 1;
      if (b === 'unscheduled') return -1;
      if (!isDateFiltered && a === todayStr) return -1;
      if (!isDateFiltered && b === todayStr) return 1;
      return a.localeCompare(b);
    });
  }, [filtered, sortBy, customOrder, todayStr, dateFrom, dateTo]);
  
  // Move order up/down in the list
  const moveOrder = (orderId: string, direction: 'up' | 'down', dateOrders: Delivery[]) => {
    const currentList = customOrder.length > 0 
      ? customOrder.filter(id => dateOrders.some(d => d.id === id))
      : dateOrders.map(o => o.id);
    // Add any orders not in customOrder yet
    dateOrders.forEach(o => {
      if (!currentList.includes(o.id)) currentList.push(o.id);
    });
    const idx = currentList.indexOf(orderId);
    if (idx === -1) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === currentList.length - 1) return;
    const newList = [...currentList];
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    [newList[idx], newList[swapIdx]] = [newList[swapIdx], newList[idx]];
    // Merge with existing customOrder for other dates
    const otherDates = customOrder.filter(id => !dateOrders.some(d => d.id === id));
    setCustomOrder([...otherDates, ...newList]);
    setRouteSaved(true);
  };

  // Get active (not delivered) stops for route optimization
  // Get the first date group for route planning (drivers route one day at a time)
  // This lets them prep tomorrow's route today when today has no deliveries
  const routingDate = useMemo(() => {
    if (grouped.length === 0) return null;
    const firstDateKey = grouped[0][0];
    return firstDateKey === 'unscheduled' ? null : firstDateKey;
  }, [grouped]);

  const optimizableStops = useMemo(() => {
    if (!routingDate) return [];
    return filtered.filter(d => {
      if (['DELIVERED','CLOSED'].includes(d.status)) return false;
      const orderDate = (d.deliveryDate || '').split('T')[0];
      return orderDate === routingDate;
    });
  }, [filtered, routingDate]);

  // Quick sort by distance from store (no map needed)
  const sortByDistance = async () => {
    if (optimizableStops.length === 0) return;
    setRouteLoading(true);
    setRouteStatus('Sorting by distance...');

    // Store location
    const storeLat = 25.946;
    const storeLng = -80.155;

    // Use server-side geocoding (which uses Google if available)
    const addresses = optimizableStops.map(d => ({
      id: d.id,
      street: d.address?.street || '',
      city: d.address?.city || '',
      zip: d.address?.zip || ''
    }));

    try {
      const resp = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses })
      });
      const { results } = await resp.json();

      // Calculate distances
      const withDist: { id: string; dist: number }[] = [];
      for (const d of optimizableStops) {
        const coords = results[d.id];
        if (coords) {
          const R = 3959;
          const dLat = (coords.lat - storeLat) * Math.PI / 180;
          const dLng = (coords.lng - storeLng) * Math.PI / 180;
          const a = Math.sin(dLat/2)**2 + Math.cos(storeLat * Math.PI / 180) * Math.cos(coords.lat * Math.PI / 180) * Math.sin(dLng/2)**2;
          const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          withDist.push({ id: d.id, dist });
        } else {
          withDist.push({ id: d.id, dist: 9999 }); // No coords = end of list
        }
      }
      // Sort by distance ascending
      withDist.sort((a, b) => a.dist - b.dist);
      setCustomOrder(withDist.map(x => x.id));
    } catch {
      console.error('Sort by distance failed');
    }
    setRouteLoading(false);
    setRouteStatus('');
  };

  const optimizeRoute = async () => {
    if (optimizableStops.length === 0) return;
    setRouteLoading(true);
    setRouteStatus('Getting your location...');

    // Get driver location
    let lat = 25.946, lng = -80.155;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, enableHighAccuracy: true })
      );
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
    } catch { setRouteStatus('Using store location as start point...'); }
    setDriverLat(lat);
    setDriverLng(lng);

    // Geocode stops that don't have coordinates
    setRouteStatus('Finding addresses on map...');
    const needGeocode = optimizableStops.filter(d => !d.address?.lat || d.address.lat === 0);
    if (needGeocode.length > 0) {
      try {
        const resp = await fetch('/api/geocode', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: needGeocode.map(d => ({ id: d.id, street: d.address?.street || '', city: d.address?.city || 'Miami', zip: d.address?.zip || '' })) })
        });
        const data = await resp.json();
        if (data.results) {
          needGeocode.forEach(d => {
            if (data.results[d.id]) {
              d.address.lat = data.results[d.id].lat;
              d.address.lng = data.results[d.id].lng;
            }
          });
        }
      } catch { /* proceed without geocoding */ }
    }

    // Optimize order
    setRouteStatus('Calculating best route...');
    const withCoords = optimizableStops.filter(d => d.address?.lat && d.address.lat !== 0);
    const withoutCoords = optimizableStops.filter(d => !d.address?.lat || d.address.lat === 0);
    
    // Warn if some orders couldn't be geocoded
    if (withoutCoords.length > 0) {
      console.warn('Orders without coordinates:', withoutCoords.map(d => d.orderNumber));
    }
    
    try {
      const resp = await fetch('/api/route/optimize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverLat: lat, driverLng: lng, stops: withCoords.map(d => ({ id: d.id, lat: d.address.lat, lng: d.address.lng })) })
      });
      const data = await resp.json();
      const orderedIds: string[] = data.orderedIds || withCoords.map((d: Delivery) => d.id);
      const ordered = orderedIds.map((id: string, idx: number) => {
        const d = withCoords.find((s: Delivery) => s.id === id);
        if (!d) return null;
        return {
          id: d.id,
          stopNumber: idx + 1,
          lat: d.address.lat,
          lng: d.address.lng,
          name: d.giftReceiverName || d.customer?.name || '—',
          address: `${d.address?.street}, ${d.address?.city}`,
          orderNumber: d.orderNumber || d.id,
        };
      }).filter(Boolean);
      
      // Add orders without coordinates at the end (they won't show on map but will be in the list)
      withoutCoords.forEach((d, idx) => {
        ordered.push({
          id: d.id,
          stopNumber: ordered.length + 1,
          lat: 0,
          lng: 0,
          name: d.giftReceiverName || d.customer?.name || '—',
          address: `⚠️ ${d.address?.street}, ${d.address?.city} (address not found on map)`,
          orderNumber: d.orderNumber || d.id,
        });
      });
      
      setRouteTotalDist(data.totalDistance || 0);
      setRouteStops(ordered);
      // Apply the optimized order to the actual list
      setCustomOrder(ordered.map((s: any) => s.id));
      setRouteSaved(true);
      setRouteSavedMsg('✓ Route optimized! Drag stops to adjust, then tap Navigate.');
      setTimeout(() => setRouteSavedMsg(''), 4000);
    } catch {
      // Even if optimize fails, show the map with all stops
      const allStops = [
        ...withCoords.map((d: Delivery, idx: number) => ({
          id: d.id, stopNumber: idx + 1,
          lat: d.address.lat, lng: d.address.lng,
          name: d.giftReceiverName || d.customer?.name || '—',
          address: `${d.address?.street}, ${d.address?.city}`,
          orderNumber: d.orderNumber || d.id,
        })),
        ...withoutCoords.map((d: Delivery, idx: number) => ({
          id: d.id, stopNumber: withCoords.length + idx + 1,
          lat: 0, lng: 0,
          name: d.giftReceiverName || d.customer?.name || '—',
          address: `⚠️ ${d.address?.street}, ${d.address?.city} (address not found)`,
          orderNumber: d.orderNumber || d.id,
        }))
      ];
      setRouteStops(allStops);
      setCustomOrder(allStops.map((s: any) => s.id));
      setRouteSaved(true);
      setRouteSavedMsg('✓ Route set! Drag stops to adjust, then tap Navigate.');
      setTimeout(() => setRouteSavedMsg(''), 4000);
    }
    setRouteLoading(false);
    setRouteStatus('');
  };

  // Drag reorder handler — swaps dragged card with drop target, updates customOrder
  const handleDropOnStop = (dateOrders: Delivery[], dragId: string, dropId: string) => {
    if (dragId === dropId) return;
    const currentList = customOrder.length > 0
      ? customOrder.filter(id => dateOrders.some(d => d.id === id))
      : dateOrders.map(d => d.id);
    const allOther = dateOrders.map(d => d.id).filter(id => !currentList.includes(id));
    const full = [...currentList, ...allOther];
    const fromIdx = full.indexOf(dragId);
    const toIdx = full.indexOf(dropId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...full];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragId);
    const otherDates = customOrder.filter(id => !dateOrders.some(d => d.id === id));
    setCustomOrder([...otherDates, ...next]);
    // Update routeStops order too if set
    if (routeStops.length > 0) {
      const reordered = next
        .map((id, i) => {
          const s = routeStops.find((r: any) => r.id === id);
          return s ? { ...s, stopNumber: i + 1 } : null;
        })
        .filter(Boolean);
      setRouteStops(reordered);
    }
    setRouteSavedMsg('✓ Order saved!');
    setTimeout(() => setRouteSavedMsg(''), 2000);
  };

  const printRouteSheet = () => {
    // Use all optimizable stops in their current order (respects drag reorder)
    const orderedStops = customOrder.length > 0
      ? [...optimizableStops].sort((a, b) => {
          const ai = customOrder.indexOf(a.id);
          const bi = customOrder.indexOf(b.id);
          return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
        })
      : optimizableStops;

    const now = new Date();
    const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeLabel = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const driverLabel = orderedStops[0]?.driverName || 'Driver';

    const labelsHtml = orderedStops.map((order, idx) => {
      const stopNum = idx + 1;
      const receiverName = order.giftReceiverName || order.customer?.name || '—';
      const receiverPhone = order.customer?.phone || '';
      const street = order.address?.street || '';
      const unit = order.address?.unit || '';
      const city = order.address?.city || '';
      const zip = order.address?.zip || '';
      const orderNum = (order.orderNumber || order.id).replace(/^#+/, '');
      const senderName = order.giftSenderName || '';
      const senderPhone = order.giftSenderPhone || '';
      const instructions = order.deliveryInstructions || '';
      const items = (order.items || []).map((it: any) => it.name || '').filter(Boolean).join(', ');
      const driver = order.driverName || driverLabel;
      const delivDate = order.deliveryDate
        ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        : dateLabel;
      const itemCount = (order.items || []).reduce((s: number, it: any) => s + (it.quantity || 1), 0);
      // Check if order has a gift message/card
      const hasGiftCard = !!(order.giftMessage && order.giftMessage.trim());

      return `
        <div class="label">
          <div class="stop-circle">${stopNum}</div>
          <div class="stop-of">Stop ${stopNum} of ${orderedStops.length}</div>

          <div class="order-num">#${orderNum}</div>
          <div class="section-label">GIFT RECEIVER</div>
          <div class="recipient">${receiverName}</div>
          ${receiverPhone ? `<div class="phone">📞 ${receiverPhone}</div>` : ''}
          <div class="address">${street}${unit ? `, ${unit}` : ''}</div>
          <div class="address">${city}, FL ${zip}</div>
          
          ${senderName ? `
          <div class="section-label sender-label">GIFT SENDER</div>
          <div class="sender-name">${senderName}</div>
          ${senderPhone ? `<div class="sender-phone">📞 ${senderPhone}</div>` : ''}
          ` : ''}
          
          <div class="items-box">
            <div class="items-count">${itemCount} ${itemCount === 1 ? 'Item' : 'Items'}</div>
            ${items ? `<div class="items-list">${items}</div>` : ''}
            <div class="gift-card-check">${hasGiftCard ? '✓' : '☐'} Gift Card Message</div>
          </div>
          
          ${instructions ? `<div class="instructions">⚠️ ${instructions}</div>` : ''}

          <div class="tear-spacer"></div>
          <div class="tear-line">
            <span class="tear-text">✂ &nbsp; TEAR HERE — LEAVE IF UNDELIVERABLE &nbsp; ✂</span>
          </div>

          <div class="undeliverable">
            <div class="ud-header">
              <span class="ud-icon">⚠️</span>
              <span class="ud-title">UNDELIVERABLE NOTICE</span>
              <span class="ud-icon">⚠️</span>
            </div>
            <div class="ud-row"><span class="ud-label">Order:</span> <span>#${orderNum}</span></div>
            <div class="ud-row"><span class="ud-label">Recipient:</span> <span>${receiverName}</span></div>
            <div class="ud-row"><span class="ud-label">Address:</span> <span>${street}${unit ? ` ${unit}` : ''}, ${city} ${zip}</span></div>
            ${receiverPhone ? `<div class="ud-row"><span class="ud-label">Phone:</span> <span>${receiverPhone}</span></div>` : ''}
            <div class="ud-row"><span class="ud-label">Driver:</span> <span>${driver}</span></div>
            <div class="ud-row"><span class="ud-label">Date:</span> <span>${delivDate}</span></div>
            <div class="ud-row"><span class="ud-label">Printed:</span> <span>${dateLabel} ${timeLabel}</span></div>
          </div>
        </div>
      `;
    }).join('');

    const css = `
  & { font-family: Arial, sans-serif; }
  * { margin: 0; padding: 0; box-sizing: border-box; }

  /* Cover page */
  .cover {
    width: 4in;
    min-height: 6in;
    padding: 0.4in;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    page-break-after: always;
    border: 2px solid #000;
  }
  .cover-logo { font-size: 28px; font-weight: 900; margin-bottom: 8px; }
  .cover-date { font-size: 14px; color: #555; margin-bottom: 24px; }
  .cover-total { font-size: 72px; font-weight: 900; line-height: 1; }
  .cover-total-label { font-size: 16px; font-weight: 700; text-transform: uppercase; color: #555; margin-top: 4px; }
  .cover-stops { margin-top: 32px; }
  .cover-stop-row { font-size: 13px; padding: 4px 0; border-bottom: 1px solid #eee; text-align: left; }
  .cover-stop-num { display: inline-block; width: 28px; height: 28px; border-radius: 50%; background: #000; color: #fff; font-weight: 900; font-size: 13px; text-align: center; line-height: 28px; margin-right: 8px; }

  /* Labels — LOCKED to 4x6 exactly. Content must never overflow to next sheet. */
  .label {
    width: 4in;
    height: 6in;
    max-height: 6in;
    padding: 0.2in 0.3in 0.15in;
    page-break-after: always;
    page-break-inside: avoid;
    break-inside: avoid;
    border: 1px solid #ccc;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .stop-circle {
    width: 0.9in;
    height: 0.9in;
    border-radius: 50%;
    background: #000;
    color: #fff;
    font-size: 48px;
    font-weight: 900;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 4px;
    line-height: 1;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .stop-of {
    text-align: center;
    font-size: 11px;
    color: #777;
    margin-bottom: 8px;
  }
  .order-num {
    font-size: 22px;
    font-weight: 900;
    color: #000;
    margin-bottom: 2px;
  }
  .recipient {
    font-size: 26px;
    font-weight: 900;
    color: #000;
    line-height: 1.1;
    margin-bottom: 2px;
  }
  .address {
    font-size: 15px;
    font-weight: 600;
    color: #222;
    line-height: 1.4;
  }
  .phone {
    font-size: 14px;
    color: #444;
    margin-top: 4px;
  }
  .section-label {
    font-size: 9px;
    font-weight: 900;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-top: 4px;
    margin-bottom: 2px;
  }
  .sender-label {
    margin-top: 12px;
    border-top: 1px dashed #ddd;
    padding-top: 8px;
  }
  .sender-name {
    font-size: 18px;
    font-weight: 900;
    color: #000;
    line-height: 1.1;
    margin-bottom: 2px;
  }
  .sender-phone {
    font-size: 13px;
    color: #444;
    margin-top: 2px;
  }
  .items-box {
    margin-top: 12px;
    padding: 8px 10px;
    border: 2px solid #000;
    border-radius: 6px;
    background: #f9f9f9;
  }
  .items-count {
    font-size: 16px;
    font-weight: 900;
    color: #000;
    margin-bottom: 4px;
  }
  .items-list {
    font-size: 11px;
    color: #555;
    line-height: 1.4;
    margin-bottom: 6px;
  }
  .gift-card-check {
    font-size: 12px;
    font-weight: 700;
    color: #333;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dashed #ccc;
  }
  .instructions {
    font-size: 12px;
    font-weight: 900;
    color: #c00;
    margin-top: 10px;
    padding: 6px 8px;
    border: 2px solid #c00;
    border-radius: 6px;
  }

  /* Tear spacer — pushes tear line down toward the bottom half */
  .tear-spacer {
    flex-grow: 1;
    min-height: 0;
  }

  /* Tear line */
  .tear-line {
    padding: 7px 0 5px;
    border-top: 2px dashed #aaa;
    flex-shrink: 0;
  }
  .tear-text {
    font-size: 7px;
    color: #aaa;
    letter-spacing: 0.3px;
    display: block;
    text-align: center;
  }

  /* Undeliverable slip — compact, fixed to bottom of label */
  .undeliverable {
    padding-top: 6px;
    flex-shrink: 0;
  }
  .ud-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-bottom: 5px;
    border-bottom: 1.5px solid #000;
    padding-bottom: 4px;
  }
  .ud-icon { font-size: 11px; }
  .ud-title {
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #000;
  }
  .ud-row {
    font-size: 9px;
    color: #222;
    padding: 1.5px 0;
    line-height: 1.5;
    display: flex;
    gap: 4px;
  }
  .ud-label { font-weight: 800; min-width: 52px; }
`;

    const coverHtml = `
<div class="cover">
  <div class="cover-logo">🍫 The Sweet Tooth</div>
  <div class="cover-date">${dateLabel} &nbsp;·&nbsp; Printed ${timeLabel}</div>
  <div class="cover-total">${orderedStops.length}</div>
  <div class="cover-total-label">Deliveries</div>
  <div class="cover-stops" style="width:100%;margin-top:24px">
    ${orderedStops.map((o, i) => {
      const n = o.giftReceiverName || o.customer?.name || '—';
      const c = o.address?.city || '';
      const num = (o.orderNumber || o.id).replace(/^#+/, '');
      const drv = o.driverName || '';
      return `<div class="cover-stop-row"><span class="cover-stop-num">${i+1}</span> #${num} — ${n} &nbsp;·&nbsp; ${c}${drv ? ' &nbsp;·&nbsp; ' + drv : ''}</div>`;
    }).join('')}
  </div>
</div>`;

    const stopsCount = orderedStops.length;
    const titleStr = `${stopsCount} Delivery Label${stopsCount === 1 ? '' : 's'} · ${dateLabel}`;
    showPrintPreview({
      content: coverHtml + labelsHtml,
      css,
      title: titleStr,
      pageSize: '4in 6in',
    });
  };

  const startNavigation = (app: 'waze' | 'google') => {
    // Build ordered stops from routeStops (already in customOrder sequence)
    const stops = routeStops.filter((s: any) => s.lat !== 0 && s.lng !== 0);
    if (stops.length === 0) return;
    if (app === 'waze') {
      const first = stops[0];
      window.open(`https://waze.com/ul?ll=${first.lat},${first.lng}&navigate=yes`, '_blank');
    } else {
      const dest = stops[stops.length - 1];
      const waypoints = stops.slice(0, -1).map((s: any) => `${s.lat},${s.lng}`).join('|');
      const url = waypoints
        ? `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`
        : `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`;
      window.open(url, '_blank');
    }
  };

  const fmtDateHeader = (iso: string) => {
    if (iso === 'unscheduled') return { label: 'Unscheduled', sub: '', isToday: false, isTomorrow: false };
    const d = new Date(iso + 'T12:00:00');
    const isToday = iso === todayStr;
    const isTomorrow = iso === tomorrowStr;
    return {
      label: isToday ? 'TODAY' : isTomorrow ? `TOMORROW — ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}` : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase(),
      sub: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      isToday,
      isTomorrow,
    };
  };

  // Stats for the header - ACCURATE counts for today's local deliveries only
  const openCount = deliveries.filter(d => 
    d.deliveryDate === todayStr && 
    d.status !== 'DELIVERED' && 
    d.status !== 'CANCELLED' && 
    d.status !== 'CLOSED'
  ).length;
  const doneTodayCount = deliveries.filter(d => 
    d.status === 'DELIVERED' && 
    (d.completedAt || '').startsWith(todayStr)
  ).length;

  return (
    <div className="flex flex-col h-full" style={{ background: '#FFFFFF' }}>

      {/* ── STATS BAR ── */}
      <div className="grid grid-cols-2 border-b border-stone-200" style={{ background: '#FFFFFF' }}>
        <div className="py-3 text-center border-r border-stone-200">
          <p className="text-2xl font-black" style={{ color: '#374151' }}>{openCount}</p>
          <p className="text-[8px] font-black uppercase text-stone-400 leading-tight">Open</p>
        </div>
        <div className="py-3 text-center">
          <p className="text-2xl font-black" style={{ color: '#22C55E' }}>{doneTodayCount}</p>
          <p className="text-[8px] font-black uppercase text-stone-400 leading-tight">Done Today</p>
        </div>
      </div>



      {/* ── STICKY HEADER ── */}
      <div className="sticky top-0 z-10 bg-white px-4 pt-3 pb-3">

        {/* Search Input */}
        <div className="mb-3">
          <div className="relative">
            <input
              type="text"
              placeholder="Search orders, names, addresses..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-stone-100 border-0 rounded-xl px-4 py-3 pl-10 text-sm font-medium outline-none focus:ring-2 focus:ring-black"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600">
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Driver filter (admin only) - light beige background */}
        <div className="flex gap-2 items-center">
          {isAdmin && (
            <select value={driverFilter} onChange={e => setDriverFilter(e.target.value)}
              style={{ background: '#F5F5F0', color: '#374151', border: 'none', borderRadius: 12, padding: '10px 14px', fontSize: 14, fontWeight: 600 }}>
              <option value="ALL">Viewing: All drivers</option>
              {activeDrivers.map(u => (
                <option key={u.id} value={u.id}>
                  Viewing: {u.name}
                </option>
              ))}
            </select>
          )}
          {/* Date Range Filter Toggle */}
          <button 
            onClick={() => setShowDateFilter(!showDateFilter)}
            className={`px-3 py-2 rounded-xl text-xs font-black uppercase flex items-center gap-1 ${dateFrom || dateTo ? 'bg-black text-white' : 'bg-stone-100 text-stone-600'}`}>
            <Calendar size={14} />
            {dateFrom || dateTo ? 'Dates ✓' : 'Dates'}
          </button>
        </div>

        {/* Date Range Picker */}
        {showDateFilter && (
          <div className="mt-3 p-3 bg-stone-50 rounded-xl border border-stone-200">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black uppercase text-stone-500">Filter by Date Range</p>
              {(dateFrom || dateTo) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); showFilterToast('Showing All Dates'); }} className="text-[10px] font-black text-red-500 uppercase">Clear</button>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="text-[9px] font-bold text-stone-400 mb-1">From</p>
                <input 
                  type="date" 
                  value={dateFrom}
                  onChange={e => setDateFrom(e.target.value)}
                  className="w-full bg-white border border-stone-200 rounded-lg px-2 py-2 text-sm font-bold"
                />
              </div>
              <div className="flex-1">
                <p className="text-[9px] font-bold text-stone-400 mb-1">To</p>
                <input 
                  type="date" 
                  value={dateTo}
                  onChange={e => setDateTo(e.target.value)}
                  className="w-full bg-white border border-stone-200 rounded-lg px-2 py-2 text-sm font-bold"
                />
              </div>
            </div>
            {/* Quick presets */}
            <div className="flex gap-2 mt-2 flex-wrap">
              <button onClick={() => { setDateFrom(''); setDateTo(''); showFilterToast('Showing All'); }} className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-[11px] font-bold active:scale-95 transition-transform">All</button>
              <button onClick={() => { setDateFrom(todayStr); setDateTo(todayStr); showFilterToast('Showing Today'); }} className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-[11px] font-bold active:scale-95 transition-transform">Today</button>
            </div>
          </div>
        )}

        {/* Filter feedback toast */}
        {filterToast && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-stone-900 text-white px-4 py-2 rounded-full text-xs font-bold shadow-lg animate-pulse">
            ✓ {filterToast}
          </div>
        )}
      </div>

      {/* ── PLAN ROUTE BUTTON ── */}
      {optimizableStops.length > 0 && routingDate && (
        <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
          <button
            onClick={() => setShowPlanRoute(true)}
            className="w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            style={{ background: '#374151', color: '#fff' }}
          >
            <MapIcon size={16} /> Plan Today's Route
          </button>
        </div>
      )}

      {/* ── ORDER LIST ── */}
      <div className="flex-1 overflow-y-auto pb-28">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Package size={40} className="text-stone-200 mb-3" />
            <p className="font-black text-stone-300 uppercase text-sm">No orders found</p>
          </div>
        ) : grouped.map(([dateKey, orders]) => {
          const hdr = fmtDateHeader(dateKey);
          const isUnscheduled = dateKey === 'unscheduled';
          return (
            <div key={dateKey}>
              {/* Date group header */}
              <div style={{
                background: isUnscheduled ? '#FEF2F2' : '#F5F5F0',
                padding: '10px 16px',
                marginBottom: 0,
                borderLeft: isUnscheduled ? '4px solid #EF4444' : 'none',
              }}>
                <p style={{
                  color: isUnscheduled ? '#DC2626' : '#374151',
                  fontSize: 13,
                  fontWeight: isUnscheduled ? 800 : 500,
                  letterSpacing: '0.3px'
                }}>
                  {isUnscheduled ? '⚠️ NO DATE — NEEDS ATTENTION' : hdr.isToday ? `TODAY — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}` : hdr.label}
                </p>
                {isUnscheduled && <p style={{ fontSize: 11, color: '#EF4444', fontWeight: 600, marginTop: 2 }}>These orders are missing a delivery date. Do not deliver until date is confirmed.</p>}
              </div>

              {/* Cards for this date */}
              <div style={{ padding: '12px 16px' }}>
              {orders.map((order, idx) => {
                const name = order.giftReceiverName || order.customer?.name || '—';
                const cleanNum = (order.orderNumber || order.id).replace(/^#+/, '');
                const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
                const isDone = DONE_STATUSES.includes(order.status);
                const showStatus = !['PENDING','ASSIGNED'].includes(order.status);

                // COMPACT VIEW for drivers (non-admin) — fit more on screen
                if (!isAdmin) {
                  return (
                    <div
                      key={order.id}
                      draggable={!isDone}
                      onDragStart={() => setDragOrderId(order.id)}
                      onDragOver={e => { e.preventDefault(); setDragOverId(order.id); }}
                      onDrop={() => { if (dragOrderId) handleDropOnStop(orders, dragOrderId, order.id); setDragOrderId(null); setDragOverId(null); }}
                      onDragEnd={() => { setDragOrderId(null); setDragOverId(null); }}
                      className={`flex items-center gap-2 p-2 rounded-xl border transition-all ${isDone ? 'bg-stone-50 border-stone-200' : dragOverId === order.id ? 'bg-blue-50 border-blue-400 scale-[1.02]' : 'bg-white border-stone-200'}`}
                    >
                      {/* Drag handle — only when route is active */}
                      {!isDone && (
                        <div className="flex flex-col items-center shrink-0 px-1 py-2 cursor-grab active:cursor-grabbing text-stone-300">
                          <span style={{ fontSize: 18, lineHeight: 1 }}>≡</span>
                        </div>
                      )}
                      {/* Stop number */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-black text-sm ${isDone ? 'bg-green-100 text-green-600' : 'bg-black text-white'}`}>
                        {isDone ? '✓' : idx + 1}
                      </div>
                      {/* Main info — tappable */}
                      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelectOrder(order)}>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-base text-stone-900">#{cleanNum}</span>
                          {order.deliveryInstructions && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                        </div>
                        <p className="text-sm font-bold text-stone-700 truncate">{name}</p>
                        <p className="text-xs text-stone-500 truncate">{order.address?.city} {order.address?.zip}</p>
                      </div>
                      {/* Nav button */}
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${order.address?.street || ''}, ${order.address?.city || ''}, FL ${order.address?.zip || ''}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center shrink-0 active:scale-95"
                      >
                        <Navigation size={18} className="text-white" />
                      </a>
                    </div>
                  );
                }

                // MINIMALIST CARD — Clean, white, quiet
                const isManualOrder = (order as any).isManual;
                const isOutForDelivery = order.status === 'IN_TRANSIT';
                
                return (
                  <div key={order.id}
                    draggable={!isDone}
                    onDragStart={() => setDragOrderId(order.id)}
                    onDragOver={e => { e.preventDefault(); setDragOverId(order.id); }}
                    onDrop={() => { if (dragOrderId) handleDropOnStop(orders, dragOrderId, order.id); setDragOrderId(null); setDragOverId(null); }}
                    onDragEnd={() => { setDragOrderId(null); setDragOverId(null); }}
                    onClick={() => onSelectOrder(order)}
                    style={{ 
                      background: '#ffffff',
                      borderRadius: 12,
                      padding: 16,
                      marginBottom: 12,
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                      borderLeft: order.attemptNumber === 2 ? '3px solid #D4AF37' : isOutForDelivery ? '3px solid #F59E0B' : '3px solid #E5E7EB',
                      cursor: 'pointer',
                    }}>
                    
                    {/* HEADER: #35213 | MIAMI | [Driver Pill] */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ color: '#6B7280', fontSize: 12, fontWeight: 500 }}>#{cleanNum}</span>
                      <span style={{ color: '#D1D5DB' }}>|</span>
                      <span style={{ color: '#374151', fontSize: 13, fontWeight: 600, textTransform: 'uppercase' }}>{order.address?.city || '—'}</span>
                      {isOutForDelivery && <span style={{ background: '#FEF3C7', color: '#92400E', fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 9999 }}>OUT</span>}
                      <div style={{ marginLeft: 'auto' }}>
                        {(() => {
                          const driverName = order.driverName || 'Unassigned';
                          // Soft pastel colors matching Gemini's design
                          let pillBg = '#F3F4F6'; // gray for unassigned
                          let pillColor = '#6B7280';
                          if (driverName.toLowerCase().includes('mike')) {
                            pillBg = '#DBEAFE'; pillColor = '#1E40AF'; // soft blue
                          } else if (driverName.toLowerCase().includes('katie')) {
                            pillBg = '#FCE7F3'; pillColor = '#BE185D'; // soft pink
                          } else if (driverName.toLowerCase().includes('smith')) {
                            pillBg = '#D1FAE5'; pillColor = '#065F46'; // soft green
                          } else if (driverName !== 'Unassigned') {
                            pillBg = '#E0E7FF'; pillColor = '#3730A3'; // soft purple for others
                          }
                          return (
                            <span style={{ 
                              background: pillBg, 
                              color: pillColor, 
                              fontSize: 12, 
                              fontWeight: 500, 
                              padding: '4px 10px', 
                              borderRadius: 9999 
                            }}>
                              {driverName}{isDone ? ' ✓' : ''}
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    {/* BODY */}
                    <div>
                      <p style={{ color: '#111827', fontSize: 15, fontWeight: 600, marginBottom: 2 }}>{name}</p>
                      {order.items?.[0] && (
                        <p style={{ color: '#9CA3AF', fontSize: 12, marginBottom: 6 }}>{order.items[0].name}</p>
                      )}
                      
                      {/* ADDRESS — Plain text, tap card to open order */}
                      <p style={{ color: '#2563EB', fontSize: 12 }}>
                        {order.address?.street}{order.address?.unit ? ` #${order.address.unit}` : ''}, {order.address?.city} {order.address?.zip}
                      </p>
                      
                      {/* Delivery instructions — subtle */}
                      {order.deliveryInstructions && (
                        <p style={{ color: '#9CA3AF', fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>
                          Note: {order.deliveryInstructions}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── PLAN ROUTE OVERLAY ── */}
      {showPlanRoute && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#F9FAFB' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-200">
            <button onClick={() => setShowPlanRoute(false)} className="flex items-center gap-1 text-sm font-bold" style={{ color: '#374151' }}>
              <ChevronLeft size={20} /> Back
            </button>
            <p className="font-black text-sm" style={{ color: '#374151' }}>Plan Route</p>
            <button
              onClick={() => {
                const numbered = optimizableStops
                  .map(o => ({ ...o, _num: parseInt(stopNumbers[o.id] || '0', 10) || 9999 }))
                  .sort((a, b) => a._num - b._num);
                const ids = numbered.map(o => o.id);
                setCustomOrder(ids);
                setTimeout(() => printRouteSheet(), 100);
              }}
              className="px-4 py-2 rounded-xl font-black text-xs active:scale-95 transition-all"
              style={{ background: '#374151', color: '#fff' }}
            >
              Print Labels
            </button>
          </div>

          {/* Sort buttons */}
          <div className="px-4 py-3 bg-white border-b border-stone-200 flex gap-2">
            <button
              onClick={sortByDistance}
              disabled={routeLoading}
              className="flex-1 py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all border-2 border-stone-300"
              style={{ background: '#fff', color: '#374151' }}
            >
              {routeLoading ? routeStatus : '📍 Sort by Distance'}
            </button>
          </div>

          {/* Draggable order list */}
          <div ref={planRouteListRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {(() => {
              const orderedStops = customOrder.length > 0
                ? [...optimizableStops].sort((a, b) => {
                    const ai = customOrder.indexOf(a.id);
                    const bi = customOrder.indexOf(b.id);
                    return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
                  })
                : optimizableStops;
              return orderedStops.map((order, idx) => {
                const name = order.giftReceiverName || order.customer?.name || '\u2014';
                const cleanNum = (order.orderNumber || order.id).replace(/^#+/, '');
                const city = order.address?.city || '';
                const street = order.address?.street || '';
                const zip = order.address?.zip || '';
                const fullAddr = `${street}, ${city}, FL ${zip}`.trim();
                const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(fullAddr)}`;
                const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}`;
                return (
                  <div
                    key={order.id}
                    data-order-id={order.id}
                    draggable
                    onDragStart={() => setDragOrderId(order.id)}
                    onDragOver={e => { e.preventDefault(); setDragOverId(order.id); }}
                    onDrop={() => {
                      if (dragOrderId) {
                        handleDropOnStop(optimizableStops, dragOrderId, order.id);
                      }
                      setDragOrderId(null);
                      setDragOverId(null);
                    }}
                    onDragEnd={() => { setDragOrderId(null); setDragOverId(null); }}
                    onTouchStart={() => {
                      touchDragId.current = order.id;
                      setDragOrderId(order.id);
                    }}
                    onTouchMove={(e) => {
                      if (!touchDragId.current || !planRouteListRef.current) return;
                      const touch = e.touches[0];
                      const elements = planRouteListRef.current.querySelectorAll('[data-order-id]');
                      elements.forEach((el) => {
                        const rect = el.getBoundingClientRect();
                        const elId = el.getAttribute('data-order-id');
                        if (touch.clientY >= rect.top && touch.clientY <= rect.bottom && elId !== touchDragId.current) {
                          setDragOverId(elId);
                        }
                      });
                    }}
                    onTouchEnd={() => {
                      if (touchDragId.current && dragOverId && touchDragId.current !== dragOverId) {
                        handleDropOnStop(optimizableStops, touchDragId.current, dragOverId);
                      }
                      touchDragId.current = null;
                      setDragOrderId(null);
                      setDragOverId(null);
                    }}
                    className={`p-3 rounded-xl border transition-all bg-white select-none ${
                      dragOrderId === order.id ? 'opacity-50 scale-95' : ''
                    } ${
                      dragOverId === order.id ? 'border-blue-400 scale-[1.02] bg-blue-50' : 'border-stone-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Drag handle */}
                      <div className="flex flex-col gap-0.5 px-2 py-3 cursor-grab active:cursor-grabbing shrink-0">
                        <div className="w-5 h-0.5 bg-stone-300 rounded" />
                        <div className="w-5 h-0.5 bg-stone-300 rounded" />
                        <div className="w-5 h-0.5 bg-stone-300 rounded" />
                      </div>

                      {/* Number circle */}
                      <div 
                        className="w-12 h-12 rounded-full flex items-center justify-center font-black text-lg border-2 shrink-0"
                        style={{ background: '#fff', color: '#374151', borderColor: '#d1d5db' }}
                      >
                        {idx + 1}
                      </div>

                      {/* Order info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-stone-400">#{cleanNum}</span>
                          <span className="text-xs font-black uppercase" style={{ color: '#374151' }}>{city}</span>
                        </div>
                        <p className="font-bold text-sm truncate" style={{ color: '#374151' }}>{name}</p>
                        <a 
                          href={wazeUrl}
                          className="text-xs text-blue-600 truncate block"
                        >
                          {street}{zip ? `, ${zip}` : ''}
                        </a>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          {/* Bottom hint */}
          <div className="px-4 py-3 bg-white border-t border-stone-200">
            <p className="text-[10px] text-stone-400 font-bold text-center">
              Hold & drag to reorder • Tap address to navigate • Print Labels when ready
            </p>
          </div>
        </div>
      )}

    </div>
  );
};



// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES PANEL — templates
// ─────────────────────────────────────────────────────────────────────────────

const MessagesPanel: React.FC<{ role: AppRole }> = ({ role }) => {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateEdits, setTemplateEdits] = useState<Record<string, string>>({});
  const [configStatus, setConfigStatus] = useState<any>(null);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates || []));
    fetch('/api/config/status').then(r => r.json()).then(d => setConfigStatus(d));
  }, []);

  const handleTestSend = async () => {
    if (!testTo) return;
    setTestLoading(true); setTestResult(null);
    const res = await fetch('/api/notify/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: testTo })
    });
    const data = await res.json();
    setTestResult(data.sent ? '✅ Sent successfully!' : '❌ Failed to send — check env vars on Render');
    setTestLoading(false);
  };

  const handleSaveTemplate = async (id: string) => {
    const body = templateEdits[id]; if (!body) return;
    const res = await fetch(`/api/templates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
    const data = await res.json();
    setTemplates(prev => prev.map(t => t.id === id ? data.template : t));
    setEditingTemplate(null);
  };

  return (
    <div className="space-y-4 p-5">

      {/* ── INTEGRATION STATUS BANNER — SUPER ADMIN ONLY ── */}
      {role === 'SUPER_ADMIN' && configStatus && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-black uppercase text-stone-500 tracking-widest mb-2">Notification Services</p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-stone-700">Email (SendGrid)</span>
            <span className={`text-xs font-black px-3 py-1 rounded-full ${configStatus.sendgrid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {configStatus.sendgrid ? '✓ Active' : '✗ NOT CONFIGURED'}
            </span>
          </div>
          {!configStatus.sendgrid && (
            <p className="text-xs text-red-600 font-bold mt-1">⚠ Email not configured. Set SENDGRID_API_KEY env var on Render.</p>
          )}
        </div>
      )}

      {/* ── TEST SEND — SUPER ADMIN ONLY ── */}
      {role === 'SUPER_ADMIN' && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
          <p className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Send Test Email</p>
          <input value={testTo} onChange={e => setTestTo(e.target.value)}
            placeholder="Email address"
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black" />
          <button onClick={handleTestSend} disabled={testLoading || !testTo}
            className="w-full py-3 bg-black text-white rounded-xl font-black uppercase text-sm disabled:opacity-40">
            {testLoading ? 'Sending...' : 'Send Test'}
          </button>
          {testResult && <p className="text-sm font-bold text-center">{testResult}</p>}
        </div>
      )}

      {/* TEMPLATES */}
      <div className="space-y-5">
        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
          <p className="text-xs font-black text-amber-700 mb-2">Available variables:</p>
          <div className="flex flex-wrap gap-1">
            {['{{customer_name}}', '{{order_number}}', '{{driver_name}}', '{{address}}', '{{failure_reason}}', '{{driver_notes}}', '{{katie_phone}}'].map(v => (
              <span key={v} className="text-[10px] font-black bg-white border border-amber-200 rounded-lg px-2 py-1 text-amber-700">{v}</span>
            ))}
          </div>
        </div>
        {templates.map(t => (
          <div key={t.id} className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-black text-stone-900">{t.label}</p>
              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${t.id === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{t.id}</span>
            </div>
            {editingTemplate === t.id ? (
              <>
                <textarea value={templateEdits[t.id] ?? t.body} onChange={e => setTemplateEdits(p => ({ ...p, [t.id]: e.target.value }))} rows={6}
                  className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black resize-none" style={{ minHeight: '120px' }} />
                <div className="flex gap-2">
                  <button onClick={() => handleSaveTemplate(t.id)} className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs">Save</button>
                  <button onClick={() => setEditingTemplate(null)} className="flex-1 py-3 bg-stone-100 text-stone-500 rounded-2xl font-black uppercase text-xs">Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-stone-600 leading-relaxed bg-stone-50 rounded-xl p-3 whitespace-pre-line">{t.body}</p>
                <button onClick={() => { setEditingTemplate(t.id); setTemplateEdits(p => ({ ...p, [t.id]: t.body })); }}
                  className="w-full py-3 bg-stone-100 text-stone-700 rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2">
                  <Edit3 size={14} /> Edit Template
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────────────────────

// ─── DRIVERS VIEW ────────────────────────────────────────────────────────────
const DriversView: React.FC<{
  allUsers: UserAccount[];
  setAllUsers: React.Dispatch<React.SetStateAction<UserAccount[]>>;
  currentUser: UserAccount;
}> = ({ allUsers, setAllUsers, currentUser }) => {
  const [newDriver, setNewDriver] = useState({ name: '', pin: '', phone: '', vehicle: '' });
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [newPinVal, setNewPinVal] = useState('');
  const [expandedSms, setExpandedSms] = useState<string | null>(null);

  const drivers = allUsers.filter(u => u.role === 'DRIVER' || u.role === 'MANAGER');

  const SMS_TEMPLATES = SMS_TEMPLATES_DATA.map(t => ({
    id: t.id,
    label: t.label,
    preview: t.build('[Driver Name]', '[Driver Phone]', '[Address]'),
  }));

  const handleAddDriver = async () => {
    setAddError(''); setAddSuccess('');
    if (!newDriver.name.trim()) { setAddError('Name is required'); return; }
    if (!newDriver.phone.trim()) { setAddError('Phone number is required'); return; }
    if (!newDriver.pin || newDriver.pin.length !== 4) { setAddError('PIN must be exactly 4 digits'); return; }
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newDriver, role: 'DRIVER' }) });
    const data = await res.json();
    if (!res.ok) { setAddError(data.error || 'Error adding driver'); return; }
    setAllUsers(prev => [...prev, data.user]);
    setNewDriver({ name: '', pin: '', phone: '', vehicle: '' });
    setAddSuccess(`✅ ${data.user.name} added successfully!`);
    setTimeout(() => setAddSuccess(''), 4000);
  };

  const toggleActive = async (user: UserAccount) => {
    const res = await fetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !user.isActive }) });
    const data = await res.json();
    setAllUsers(prev => prev.map(u => u.id === user.id ? data.user : u));
  };

  const handleResetPin = async (userId: string) => {
    if (newPinVal.length !== 4) { alert('Must be exactly 4 digits'); return; }
    await fetch(`/api/users/${userId}/reset-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPin: newPinVal }) });
    setResetPinId(null); setNewPinVal('');
    alert('✅ PIN updated!');
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-y-auto pb-28">

      {/* Header */}
      <div style={{ background: '#F5F5F0', padding: '12px 16px' }}>
        <p style={{ color: '#374151', fontSize: 14, fontWeight: 600 }}>👥 Driver Management</p>
        <p style={{ color: '#9CA3AF', fontSize: 11, marginTop: 2 }}>{drivers.length} driver{drivers.length !== 1 ? 's' : ''} · Name + phone required</p>
      </div>

      {/* Add new driver */}
      <div className="mx-4 mt-4 bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div style={{ background: '#F5F5F0', padding: '12px 16px' }}>
          <p style={{ color: '#374151', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>➕ Add New Driver</p>
        </div>
        <div className="p-4 space-y-3">
          <input value={newDriver.name} onChange={e => setNewDriver(p => ({ ...p, name: e.target.value }))}
            placeholder="Full name *"
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black" />
          <input value={newDriver.phone} onChange={e => setNewDriver(p => ({ ...p, phone: e.target.value }))}
            placeholder="Phone number * (used in SMS templates)"
            type="tel"
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black" />
          <input value={newDriver.pin} onChange={e => setNewDriver(p => ({ ...p, pin: e.target.value.replace(/\D/g,'').slice(0,4) }))}
            placeholder="4-digit PIN to login *"
            type="password" inputMode="numeric" maxLength={4}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black" />
          <input value={newDriver.vehicle} onChange={e => setNewDriver(p => ({ ...p, vehicle: e.target.value }))}
            placeholder="Vehicle"
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black" />
          {addError && <p className="text-red-600 text-xs font-bold">⚠️ {addError}</p>}
          {addSuccess && <p className="text-green-600 text-xs font-bold">{addSuccess}</p>}
          <button onClick={handleAddDriver}
            className="w-full py-3.5 bg-black text-white rounded-xl font-black uppercase text-sm active:scale-95 transition-all">
            Add Driver
          </button>
        </div>
      </div>

      {/* SMS Templates preview */}
      <div className="mx-4 mt-4 bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div style={{ background: '#F5F5F0', padding: '12px 16px' }}>
          <p style={{ color: '#374151', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>💬 Driver SMS Templates</p>
          <p style={{ color: '#9CA3AF', fontSize: 10, marginTop: 2 }}>Auto-filled with driver name & number when sent</p>
        </div>
        <div className="divide-y divide-stone-100">
          {SMS_TEMPLATES.map(t => (
            <div key={t.id}>
              <button onClick={() => setExpandedSms(expandedSms === t.id ? null : t.id)}
                className="w-full flex items-center justify-between px-4 py-3 active:bg-stone-50">
                <span className="text-sm font-bold text-stone-900">{t.label}</span>
                <ChevronRight size={16} className={`text-stone-400 transition-transform ${expandedSms === t.id ? 'rotate-90' : ''}`} />
              </button>
              {expandedSms === t.id && (
                <div className="px-4 pb-3">
                  <div className="bg-stone-50 border border-stone-200 rounded-xl p-3">
                    <p className="text-sm text-stone-700 leading-relaxed">
                      {t.preview}
                    </p>
                  </div>
                  <p className="text-[10px] text-stone-400 mt-2 italic">Brackets auto-fill with real driver info when sent from order detail</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Driver list */}
      <div className="mx-4 mt-4 bg-white rounded-2xl border border-stone-200 overflow-hidden mb-4">
        <div style={{ background: '#F5F5F0', padding: '12px 16px' }}>
          <p style={{ color: '#374151', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>🚗 Active Drivers</p>
        </div>
        {drivers.length === 0 ? (
          <div className="text-center py-10">
            <Users size={28} className="mx-auto text-stone-200 mb-2" />
            <p className="text-xs text-stone-400 font-bold">No drivers yet</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {drivers.map(driver => (
              <div key={driver.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-sm ${driver.isActive ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-400'}`}>
                      {driver.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-black text-stone-900">{driver.name}</p>
                      <p className="text-xs text-stone-500">{driver.phone || <span className="text-red-400 font-bold">No phone — add one!</span>}</p>
                      {driver.vehicle && <p className="text-[10px] text-stone-400">{driver.vehicle}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${driver.isActive ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-400'}`}>
                      {driver.isActive ? 'Active' : 'Off'}
                    </span>
                    <button onClick={() => toggleActive(driver)}
                      className="text-[9px] font-black uppercase px-2 py-1 bg-stone-100 text-stone-600 rounded-full active:bg-stone-200">
                      {driver.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
                {/* Reset PIN inline */}
                {resetPinId === driver.id ? (
                  <div className="flex gap-2 mt-2">
                    <input value={newPinVal} onChange={e => setNewPinVal(e.target.value.replace(/\D/g,'').slice(0,4))}
                      placeholder="New 4-digit PIN" type="password" inputMode="numeric" maxLength={4}
                      className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                    <button onClick={() => handleResetPin(driver.id)}
                      className="px-3 py-2 bg-black text-white rounded-lg text-xs font-black">Save</button>
                    <button onClick={() => { setResetPinId(null); setNewPinVal(''); }}
                      className="px-3 py-2 bg-stone-100 text-stone-600 rounded-lg text-xs font-black">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => { setResetPinId(driver.id); setNewPinVal(''); }}
                    className="mt-2 text-[10px] font-black uppercase text-blue-500 active:text-blue-700">
                    🔑 Change Login PIN
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface DriverPayCardProps {
  row: { id: string; name: string; count: number; total: number; stops: Delivery[] };
}
const DriverPayCard: React.FC<DriverPayCardProps> = ({ row }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-stone-100 rounded-[24px] shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 active:bg-stone-50"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-stone-900 flex items-center justify-center text-white font-black text-sm shrink-0">
            {row.name.charAt(0).toUpperCase()}
          </div>
          <div className="text-left">
            <p className="font-black text-stone-900 text-sm">{row.name}</p>
            <p className="text-[10px] font-bold text-stone-400 uppercase">{row.count} {row.count === 1 ? 'delivery' : 'deliveries'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black text-stone-900">${row.total.toFixed(2)}</span>
          <ChevronDown size={16} className={`text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="border-t border-stone-100 divide-y divide-stone-50">
          {row.stops.map(d => (
            <div key={d.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-xs font-black text-stone-800">#{d.orderNumber}</p>
                <p className="text-[10px] text-stone-400 font-medium">{d.address?.city || '—'} · {d.address?.zip || ''}</p>
              </div>
              <span className="text-sm font-black text-stone-700">${(d.deliveryFee || 0).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// PENDING RESCHEDULE QUEUE — Shows orders that need to be rescheduled
// ─────────────────────────────────────────────────────────────────────────────
const PendingRescheduleQueue: React.FC<{ allUsers: UserAccount[] }> = ({ allUsers }) => {
  const [orders, setOrders] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [saving, setSaving] = useState(false);

  // Fetch orders that need rescheduling
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const res = await fetch('/api/deliveries');
        const data = await res.json();
        const needsReschedule = (data.deliveries || []).filter((d: Delivery) => 
          d.status === DeliveryStatus.FAILED || 
          d.status === DeliveryStatus.PENDING_RESCHEDULE ||
          d.status === DeliveryStatus.SECOND_ATTEMPT
        );
        setOrders(needsReschedule);
      } catch (err) {
        console.error('Failed to fetch orders:', err);
      }
      setLoading(false);
    };
    fetchOrders();
  }, []);

  const handleReschedule = async (orderId: string, newDate: string) => {
    setSaving(true);
    try {
      await fetch(`/api/orders/${orderId}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryDate: newDate })
      });
      // Update local state
      setOrders(prev => prev.filter(o => o.id !== orderId));
      setRescheduleId(null);
      setRescheduleDate('');
    } catch (err) {
      console.error('Failed to reschedule:', err);
    }
    setSaving(false);
  };

  const getNextBusinessDay = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    // Skip weekends
    while (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() + 1);
    }
    return d.toISOString().split('T')[0];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw size={24} className="animate-spin text-stone-300" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-12">
        <CheckCircle2 size={40} className="mx-auto text-green-400 mb-3" />
        <p className="font-black text-green-600">All caught up!</p>
        <p className="text-xs text-stone-400 mt-1">No orders need rescheduling</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="font-black text-sm text-red-600">{orders.length} Need Attention</p>
      </div>

      {orders.map(order => {
        const isExpanded = rescheduleId === order.id;
        return (
          <div key={order.id} className="bg-white border border-red-100 rounded-2xl overflow-hidden">
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-black text-xs text-stone-400">#{(order.orderNumber || '').replace(/^#+/, '')}</span>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                  order.status === DeliveryStatus.FAILED ? 'bg-red-100 text-red-700' :
                  order.status === DeliveryStatus.PENDING_RESCHEDULE ? 'bg-amber-100 text-amber-700' :
                  'bg-stone-100 text-stone-600'
                }`}>
                  {order.status === DeliveryStatus.FAILED ? '1st Failed' : 
                   order.status === DeliveryStatus.PENDING_RESCHEDULE ? 'Needs Reschedule' : 
                   '2nd Attempt'}
                </span>
              </div>
              <p className="font-black text-base">{order.giftReceiverName || order.customer?.name || '—'}</p>
              <p className="text-xs text-stone-500">{order.address?.city} {order.address?.zip}</p>
              
              {!isExpanded ? (
                <div className="flex gap-2 mt-3">
                  <button 
                    onClick={() => handleReschedule(order.id, getNextBusinessDay())}
                    disabled={saving}
                    className="flex-1 py-2 bg-amber-500 text-white rounded-xl font-black text-xs uppercase active:scale-95 disabled:opacity-50">
                    ↻ Next Business Day
                  </button>
                  <button 
                    onClick={() => { setRescheduleId(order.id); setRescheduleDate(''); }}
                    className="px-4 py-2 bg-stone-100 text-stone-600 rounded-xl font-black text-xs uppercase active:scale-95">
                    Pick Date
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <input 
                    type="date" 
                    value={rescheduleDate}
                    onChange={e => setRescheduleDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm font-bold"
                  />
                  <div className="flex gap-2">
                    <button 
                      onClick={() => { if (rescheduleDate) handleReschedule(order.id, rescheduleDate); }}
                      disabled={!rescheduleDate || saving}
                      className="flex-1 py-2 bg-green-600 text-white rounded-xl font-black text-xs uppercase active:scale-95 disabled:opacity-50">
                      {saving ? 'Saving...' : '✓ Confirm'}
                    </button>
                    <button 
                      onClick={() => setRescheduleId(null)}
                      className="px-4 py-2 bg-stone-100 text-stone-600 rounded-xl font-black text-xs uppercase active:scale-95">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const AdminPanel: React.FC<{ role: AppRole; deliveries: Delivery[]; allUsers: UserAccount[]; setAllUsers: React.Dispatch<React.SetStateAction<UserAccount[]>>; currentUser: UserAccount; }> = ({ role, deliveries, allUsers, setAllUsers, currentUser }) => {
  // Modal/accordion states
  const [feesModalOpen, setFeesModalOpen] = useState(false);
  const [feesTab, setFeesTab] = useState<'LOOKUP' | 'PAY_CALC'>('LOOKUP');
  const [activeNav, setActiveNav] = useState<'MESSAGES' | null>(null);
  const [addDriverExpanded, setAddDriverExpanded] = useState(false);
  const [smsTemplatesExpanded, setSmsTemplatesExpanded] = useState(false);
  const [driverMenuOpen, setDriverMenuOpen] = useState<string | null>(null);
  
  // Form states
  const [newDriver, setNewDriver] = useState({ name: '', pin: '', phone: '', vehicle: '' });
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [newPinVal, setNewPinVal] = useState('');
  
  // SMS Templates
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  
  // Fee calculator states
  const [feeZip, setFeeZip] = useState('');
  const [feeResult, setFeeResult] = useState<number | null>(null);
  const [feeStart, setFeeStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
  const [feeEnd, setFeeEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [feeCalculated, setFeeCalculated] = useState(false);
  const [calcStart, setCalcStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
  const [calcEnd, setCalcEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [feeDriverFilter, setFeeDriverFilter] = useState<string>('ALL');
  
  // Driver Pay Calculator states
  const [payCalcOpen, setPayCalcOpen] = useState(false);
  const [payDriverId, setPayDriverId] = useState<string>('');
  const [payDateRange, setPayDateRange] = useState<'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'LAST_WEEK' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM'>('THIS_WEEK');
  const [payStartDate, setPayStartDate] = useState(() => { const d = new Date(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); return new Date(d.setDate(diff)).toISOString().split('T')[0]; });
  const [payEndDate, setPayEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [payRatePerDelivery, setPayRatePerDelivery] = useState<string>('');
  const [payDeduction, setPayDeduction] = useState<string>('');
  const [payDeductionNote, setPayDeductionNote] = useState<string>('');
  const [payBonus, setPayBonus] = useState<string>('');
  const [payBonusNote, setPayBonusNote] = useState<string>('');
  const [driverRates, setDriverRates] = useState<Record<string, number>>({});
  const [payCalculated, setPayCalculated] = useState(false);
  const [payAllDrivers, setPayAllDrivers] = useState(false);
  const payResultsRef = useRef<HTMLDivElement>(null);
  
  // Default driver
  const [defaultDriverId, setDefaultDriverId] = useState<string>('');
  const [defaultDriverSaved, setDefaultDriverSaved] = useState(false);

  // Bulk POD email send
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ sent: number; total: number } | null>(null);


  useEffect(() => {
    fetch('/api/config/default-driver').then(r => r.json()).then(d => { if (d.driverId) setDefaultDriverId(d.driverId); });
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates || []));
    fetch('/api/config/driver-rates').then(r => r.json()).then(d => { if (d.rates) setDriverRates(d.rates); }).catch(() => {});
  }, []);
  
  // Driver Pay Calculator helpers
  const getDateRangeForPay = () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    if (payDateRange === 'TODAY') {
      return { start: todayStr, end: todayStr };
    } else if (payDateRange === 'YESTERDAY') {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const yStr = yesterday.toISOString().split('T')[0];
      return { start: yStr, end: yStr };
    } else if (payDateRange === 'THIS_WEEK') {
      const day = today.getDay();
      const monday = new Date(today);
      monday.setDate(today.getDate() - day + (day === 0 ? -6 : 1));
      return { start: monday.toISOString().split('T')[0], end: todayStr };
    } else if (payDateRange === 'LAST_WEEK') {
      const day = today.getDay();
      const lastMonday = new Date(today);
      lastMonday.setDate(today.getDate() - day - 6);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      return { start: lastMonday.toISOString().split('T')[0], end: lastSunday.toISOString().split('T')[0] };
    } else if (payDateRange === 'THIS_MONTH') {
      const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: firstOfMonth.toISOString().split('T')[0], end: todayStr };
    } else if (payDateRange === 'LAST_MONTH') {
      const firstOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: firstOfLastMonth.toISOString().split('T')[0], end: lastOfLastMonth.toISOString().split('T')[0] };
    }
    return { start: payStartDate, end: payEndDate };
  };
  
  const getDeliveredCountForDriver = (driverId: string, start: string, end: string) => {
    return deliveries.filter(d => 
      d.driverId === driverId && 
      d.status === 'DELIVERED' &&
      d.completedAt &&
      d.completedAt.split('T')[0] >= start &&
      d.completedAt.split('T')[0] <= end
    ).length;
  };
  
  const calculateDriverPay = (driverId: string) => {
    const { start, end } = getDateRangeForPay();
    const count = getDeliveredCountForDriver(driverId, start, end);
    const rate = parseFloat(payRatePerDelivery) || driverRates[driverId] || 0;
    const subtotal = count * rate;
    const deduction = parseFloat(payDeduction) || 0;
    const bonus = parseFloat(payBonus) || 0;
    return { count, rate, subtotal, deduction, bonus, total: subtotal - deduction + bonus };
  };
  
  const handleSaveDriverRate = async (driverId: string, rate: number) => {
    const newRates = { ...driverRates, [driverId]: rate };
    setDriverRates(newRates);
    await fetch('/api/config/driver-rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rates: newRates }) });
  };
  
  // Fee History
  const [feeHistory, setFeeHistory] = useState<Array<{
    id: string;
    driverId: string;
    driverName: string;
    dateRange: string;
    deliveries: number;
    rate: number;
    subtotal: number;
    deduction: number;
    deductionNote: string;
    bonus: number;
    bonusNote: string;
    total: number;
    calculatedAt: string;
  }>>([]);
  
  // Load fee history on mount
  useEffect(() => {
    fetch('/api/config/fee-history').then(r => r.json()).then(d => { if (d.history) setFeeHistory(d.history); }).catch(() => {});
  }, []);
  
  const saveFeeCalculation = async () => {
    if (!payDriverId || !payCalculated) return;
    const result = calculateDriverPay(payDriverId);
    const { start, end } = getDateRangeForPay();
    const driverName = allUsers.find(u => u.id === payDriverId)?.name || 'Unknown';
    const entry = {
      id: Date.now().toString(),
      driverId: payDriverId,
      driverName,
      dateRange: `${start} — ${end}`,
      deliveries: result.count,
      rate: result.rate,
      subtotal: result.subtotal,
      deduction: result.deduction,
      deductionNote: payDeductionNote,
      bonus: result.bonus,
      bonusNote: payBonusNote,
      total: result.total,
      calculatedAt: new Date().toISOString(),
    };
    const newHistory = [entry, ...feeHistory];
    setFeeHistory(newHistory);
    await fetch('/api/config/fee-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history: newHistory }) });
  };
  
  const deleteFeeHistoryEntry = async (id: string) => {
    const newHistory = feeHistory.filter(h => h.id !== id);
    setFeeHistory(newHistory);
    await fetch('/api/config/fee-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history: newHistory }) });
  };

  const drivers = allUsers.filter(u => u.role === 'DRIVER' || u.role === 'MANAGER');
  const currentDefaultDriver = allUsers.find(u => u.id === defaultDriverId) || allUsers.find(u => u.name === 'Katie');

  // Handlers
  const handleSaveDefaultDriver = async () => {
    const driver = allUsers.find(u => u.id === defaultDriverId);
    if (!driver) return;
    await fetch('/api/config/default-driver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId: driver.id, driverName: driver.name }) });
    setDefaultDriverSaved(true);
    setTimeout(() => setDefaultDriverSaved(false), 2000);
  };

  // Bulk send POD emails to all delivered orders that haven't been notified
  const handleBulkSendPOD = async () => {
    setBulkSending(true);
    setBulkResult(null);
    
    // Find delivered orders with email that haven't been notified
    const deliveredWithEmail = deliveries.filter(d => 
      d.status === 'DELIVERED' && 
      d.customer?.email && 
      !d.successNotificationSent
    );
    
    if (deliveredWithEmail.length === 0) {
      setBulkResult({ sent: 0, total: 0 });
      setBulkSending(false);
      return;
    }
    
    const ordersToSend = deliveredWithEmail.map(d => ({
      orderId: d.id,
      email: d.customer?.email || '',
      receiverName: d.giftReceiverName || 'the recipient',
      deliveryTime: d.completedAt 
        ? new Date(d.completedAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
        : 'today'
    }));
    
    try {
      const res = await fetch('/api/notify/bulk-pod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: ordersToSend })
      });
      const data = await res.json();
      setBulkResult({ sent: data.sent || 0, total: data.total || ordersToSend.length });
    } catch {
      setBulkResult({ sent: 0, total: ordersToSend.length });
    }
    setBulkSending(false);
  };

  const handleAddDriver = async () => {
    setAddError(''); setAddSuccess('');
    if (!newDriver.name || !newDriver.pin || !newDriver.phone) { setAddError('Name, PIN, and phone required'); return; }
    if (newDriver.pin.length !== 4) { setAddError('PIN must be 4 digits'); return; }
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newDriver, role: 'DRIVER' }) });
    const data = await res.json();
    if (!res.ok) { setAddError(data.error); return; }
    setAllUsers(prev => [...prev, data.user]);
    setNewDriver({ name: '', pin: '', phone: '', vehicle: '' });
    setAddSuccess(`${data.user.name} added!`);
    setAddDriverExpanded(false);
    setTimeout(() => setAddSuccess(''), 3000);
  };

  const toggleActive = async (user: UserAccount) => {
    const res = await fetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !user.isActive }) });
    const data = await res.json();
    setAllUsers(prev => prev.map(u => u.id === user.id ? data.user : u));
    setDriverMenuOpen(null);
  };

  const handleResetPin = async (userId: string) => {
    if (newPinVal.length !== 4) { alert('Must be 4 digits'); return; }
    await fetch(`/api/users/${userId}/reset-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPin: newPinVal }) });
    setResetPinId(null); setNewPinVal(''); setDriverMenuOpen(null);
    alert('PIN reset!');
  };

  const handleZipLookup = () => {
    const fee = DELIVERY_FEES[feeZip];
    setFeeResult(fee !== undefined ? fee : -1);
  };

  // Fee calculations
  const inRange = feeCalculated ? deliveries.filter(d => {
    if (d.status !== DeliveryStatus.DELIVERED) return false;
    const dateToCheck = (d.completedAt || d.submittedAt || d.deliveryDate || '').split('T')[0];
    if (!dateToCheck) return true;
    return dateToCheck >= calcStart && dateToCheck <= calcEnd;
  }) : [];

  const byDriver: Record<string, { name: string; stops: Delivery[] }> = {};
  inRange.forEach(d => {
    const key = d.driverId || 'unassigned';
    const name = d.driverName || 'Unassigned';
    if (!byDriver[key]) byDriver[key] = { name, stops: [] };
    byDriver[key].stops.push(d);
  });

  const driverRows = Object.entries(byDriver).map(([id, { name, stops }]) => {
    const total = stops.reduce((s, d) => s + (d.deliveryFee || 0), 0);
    return { id, name, count: stops.length, total, stops };
  }).sort((a, b) => b.total - a.total);

  const filteredRows = feeDriverFilter === 'ALL' ? driverRows : driverRows.filter(r => r.id === feeDriverFilter);
  const grandTotal = filteredRows.reduce((s, r) => s + r.total, 0);
  const grandCount = filteredRows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="px-4 pt-3 space-y-3 pb-4">

      {/* ═══════════════════════════════════════════════════════════════════
          1. ADMIN TOOLS TILES (Fees highlighted yellow)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-4 gap-2">
        <button onClick={() => setFeesModalOpen(true)}
          className="flex flex-col items-center justify-center py-3 rounded-2xl bg-amber-400 shadow-md active:scale-95 transition-all">
          <DollarSign size={20} className="text-amber-900" />
          <span className="text-[9px] font-black uppercase mt-1 text-amber-900">Fees</span>
        </button>
        <button onClick={() => setActiveNav(null)}
          className="flex flex-col items-center justify-center py-3 rounded-2xl bg-white border border-stone-200 text-stone-600 active:scale-95">
          <Users size={20} />
          <span className="text-[9px] font-black uppercase mt-1">Drivers</span>
        </button>
        <button onClick={() => setActiveNav('MESSAGES')}
          className={`flex flex-col items-center justify-center py-3 rounded-2xl transition-all active:scale-95 ${activeNav === 'MESSAGES' ? 'bg-black text-white' : 'bg-white border border-stone-200 text-stone-600'}`}>
          <MessageSquare size={20} />
          <span className="text-[9px] font-black uppercase mt-1">Messages</span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          2. DEFAULT DRIVER (Slim white card)
          ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-2xl p-3 shadow-sm flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-green-500 flex items-center justify-center text-white font-black text-sm shrink-0">
          {currentDefaultDriver?.name?.charAt(0) || 'K'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[9px] font-bold uppercase text-stone-400">Default Driver</p>
          <p className="font-black text-stone-900 text-sm truncate">{currentDefaultDriver?.name || 'Katie'}</p>
        </div>
        <select value={defaultDriverId} onChange={e => setDefaultDriverId(e.target.value)}
          className="bg-stone-50 border border-stone-200 rounded-xl px-2 py-1.5 text-sm font-bold outline-none max-w-[100px]">
          {allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <button onClick={handleSaveDefaultDriver}
          className="px-3 py-1.5 bg-black text-white rounded-xl font-black text-[10px] uppercase active:scale-95">
          {defaultDriverSaved ? '✓' : 'Save'}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          MESSAGES TAB CONTENT
          ═══════════════════════════════════════════════════════════════════ */}
      {activeNav === 'MESSAGES' && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <MessagesPanel role={role} />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          3. TEAM MANAGEMENT — Consolidated Driver List (when not on other tabs)
          ═══════════════════════════════════════════════════════════════════ */}
      {activeNav === null && (
        <>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-100">
              <p className="text-[10px] font-black uppercase text-stone-500 tracking-wider">Team Management</p>
            </div>
            
            {drivers.length === 0 ? (
              <div className="py-8 text-center text-stone-300">
                <Users size={24} className="mx-auto mb-2" />
                <p className="text-xs font-bold">No drivers yet</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-100">
                {drivers.map(u => (
                  <div key={u.id} className={`px-4 py-3 flex items-center gap-3 ${!u.isActive ? 'opacity-40' : ''}`}>
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center font-black text-stone-600 text-sm shrink-0">
                      {u.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase()}
                    </div>
                    {/* Name + details */}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-stone-900 truncate">{u.name}</p>
                      <p className="text-xs text-stone-400 truncate">{u.phone || 'No phone'}{u.vehicle ? ` · ${u.vehicle}` : ''}</p>
                    </div>
                    {/* Status badge */}
                    <div className={`px-2 py-1 rounded-full text-[9px] font-black uppercase ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
                      {u.isActive ? 'Active' : 'Off'}
                    </div>
                    {/* Three-dot menu */}
                    <div className="relative">
                      <button onClick={() => setDriverMenuOpen(driverMenuOpen === u.id ? null : u.id)}
                        className="w-8 h-8 rounded-full hover:bg-stone-100 flex items-center justify-center">
                        <MoreVertical size={16} className="text-stone-400" />
                      </button>
                      {driverMenuOpen === u.id && (
                        <div className="absolute right-0 top-10 bg-white rounded-xl shadow-lg border border-stone-200 py-1 z-50 min-w-[140px]">
                          <button onClick={() => toggleActive(u)}
                            className={`w-full px-4 py-2 text-left text-sm font-medium ${u.isActive ? 'text-red-600' : 'text-green-600'}`}>
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button onClick={() => { setResetPinId(u.id); setNewPinVal(''); setDriverMenuOpen(null); }}
                            className="w-full px-4 py-2 text-left text-sm font-medium text-stone-700">
                            Change PIN
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Reset PIN inline */}
            {resetPinId && (
              <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 flex items-center gap-2">
                <span className="text-xs font-bold text-amber-800">New PIN:</span>
                <input type="text" placeholder="4 digits" maxLength={4} inputMode="numeric"
                  value={newPinVal} onChange={e => setNewPinVal(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-20 bg-white border border-amber-300 rounded-lg px-3 py-2 text-sm font-black text-center tracking-widest outline-none" />
                <button onClick={() => handleResetPin(resetPinId)}
                  className="px-3 py-2 bg-black text-white rounded-lg font-bold text-xs">Save</button>
                <button onClick={() => { setResetPinId(null); setNewPinVal(''); }}
                  className="px-3 py-2 bg-stone-200 text-stone-600 rounded-lg font-bold text-xs">Cancel</button>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════════════════════════
              4. COLLAPSIBLE ACCORDIONS (At bottom, collapsed by default)
              ═══════════════════════════════════════════════════════════════════ */}
          
          {/* [+] Add New Driver */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => setAddDriverExpanded(!addDriverExpanded)}
              className="w-full px-4 py-3 flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center ${addDriverExpanded ? 'bg-black' : 'bg-stone-100'}`}>
                <Plus size={16} className={addDriverExpanded ? 'text-white' : 'text-stone-500'} />
              </div>
              <span className="font-bold text-stone-800 flex-1 text-left">Add New Driver</span>
              <ChevronDown size={18} className={`text-stone-400 transition-transform ${addDriverExpanded ? 'rotate-180' : ''}`} />
            </button>
            {addDriverExpanded && (
              <div className="px-4 pb-4 space-y-2 border-t border-stone-100 pt-3">
                <input type="text" placeholder="Name" value={newDriver.name} 
                  onChange={e => setNewDriver(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none" />
                <input type="tel" placeholder="Phone" value={newDriver.phone} 
                  onChange={e => setNewDriver(p => ({ ...p, phone: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none" />
                <input type="text" placeholder="4-digit PIN" maxLength={4} inputMode="numeric" value={newDriver.pin}
                  onChange={e => setNewDriver(p => ({ ...p, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none" />
                <input type="text" placeholder="Vehicle" value={newDriver.vehicle} 
                  onChange={e => setNewDriver(p => ({ ...p, vehicle: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-medium outline-none" />
                {addError && <p className="text-xs font-bold text-red-500">{addError}</p>}
                {addSuccess && <p className="text-xs font-bold text-green-600">{addSuccess}</p>}
                <button onClick={handleAddDriver}
                  className="w-full py-3 bg-black text-white rounded-xl font-black uppercase text-sm active:scale-95">
                  Add Driver
                </button>
              </div>
            )}
          </div>

          {/* 📧 Send POD Emails — SUPER ADMIN ONLY */}
          {currentUser.role === 'SUPER_ADMIN' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center">
                  <Mail size={16} className="text-green-600" />
                </div>
                <span className="font-bold text-stone-800 flex-1 text-left">Send POD Emails</span>
              </div>
              <p className="text-xs text-stone-500 mb-3">Send delivery confirmation emails to all delivered orders that haven't been notified yet.</p>
              <button 
                onClick={handleBulkSendPOD}
                disabled={bulkSending}
                className="w-full py-3 bg-green-600 text-white rounded-xl font-black uppercase text-sm active:scale-95 disabled:opacity-50">
                {bulkSending ? 'Sending...' : '📧 Send POD Emails Now'}
              </button>
              {bulkResult && (
                <p className={`text-center text-sm font-bold mt-2 ${bulkResult.sent > 0 ? 'text-green-600' : 'text-stone-500'}`}>
                  {bulkResult.total === 0 ? 'No pending emails to send' : `✅ Sent ${bulkResult.sent}/${bulkResult.total} emails`}
                </p>
              )}
            </div>
          </div>
          )}

          {/* 💬 Driver SMS Templates */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => setSmsTemplatesExpanded(!smsTemplatesExpanded)}
              className="w-full px-4 py-3 flex items-center gap-3">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center ${smsTemplatesExpanded ? 'bg-black' : 'bg-stone-100'}`}>
                <MessageCircle size={16} className={smsTemplatesExpanded ? 'text-white' : 'text-stone-500'} />
              </div>
              <span className="font-bold text-stone-800 flex-1 text-left">Driver SMS Templates</span>
              <ChevronDown size={18} className={`text-stone-400 transition-transform ${smsTemplatesExpanded ? 'rotate-180' : ''}`} />
            </button>
            {smsTemplatesExpanded && (
              <div className="px-4 pb-4 border-t border-stone-100 pt-3 space-y-2">
                {templates.length === 0 ? (
                  <p className="text-xs text-stone-400 text-center py-4">Loading templates...</p>
                ) : (
                  <>
                    <p className="text-[9px] font-black uppercase text-stone-400 mb-2">Quick-send buttons for drivers</p>
                    {templates.map(t => (
                      <div key={t.id} className="p-3 bg-stone-50 rounded-xl">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm text-stone-800">{t.label}</span>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${t.id === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{t.id}</span>
                        </div>
                        <p className="text-xs text-stone-500 leading-relaxed line-clamp-2">{t.body}</p>
                      </div>
                    ))}
                    <button onClick={() => setActiveNav('MESSAGES')}
                      className="w-full py-2 mt-2 text-xs font-bold text-stone-500 underline">
                      Edit templates in Messages →
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          FEES MODAL — Simplified: Total Fees + Driver Earnings + ZIP Lookup
          ═══════════════════════════════════════════════════════════════════ */}
      {feesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setFeesModalOpen(false)} />
          <div className="relative bg-white w-full max-w-md max-h-[85vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            
            {/* Header - Fixed at top */}
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-4 flex-shrink-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <DollarSign size={22} className="text-white" />
                  <span className="font-black text-white text-xl">Fees & Earnings</span>
                </div>
                <button onClick={() => setFeesModalOpen(false)}
                  className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center active:bg-white/30">
                  <X size={20} className="text-white" />
                </button>
              </div>
              {/* Tabs */}
              <div className="flex gap-1.5">
                <button onClick={() => setFeesTab('LOOKUP')}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${feesTab === 'LOOKUP' ? 'bg-white text-emerald-700 shadow-md' : 'bg-white/20 text-white'}`}>
                  💰 Total Fees
                </button>
                <button onClick={() => setFeesTab('PAY_CALC')}
                  className={`flex-1 py-2.5 rounded-xl font-bold text-sm transition-all ${feesTab === 'PAY_CALC' ? 'bg-white text-emerald-700 shadow-md' : 'bg-white/20 text-white'}`}>
                  👤 Driver Earnings
                </button>
              </div>
            </div>
            
            {/* Content - Scrollable */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              
              {/* ══════════ TOTAL FEES TAB (Primary Feature) ══════════ */}
              {feesTab === 'LOOKUP' && (
                <>
                  {/* Quick Date Presets - Tap to select */}
                  <div className="bg-stone-50 rounded-2xl p-4">
                    <p className="text-xs font-bold uppercase text-stone-400 mb-3 text-center">Select Time Period</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { key: 'TODAY', label: 'Today' },
                        { key: 'YESTERDAY', label: 'Yesterday' },
                        { key: 'THIS_WEEK', label: 'This Week' },
                        { key: 'LAST_WEEK', label: 'Last Week' },
                        { key: 'THIS_MONTH', label: 'This Month' },
                        { key: 'LAST_MONTH', label: 'Last Month' },
                      ] as const).map(({ key, label }) => (
                        <button key={key} onClick={() => setPayDateRange(key as typeof payDateRange)}
                          className={`py-3.5 rounded-xl font-bold text-sm transition-all ${payDateRange === key ? 'bg-emerald-500 text-white shadow-lg' : 'bg-white border-2 border-stone-200 text-stone-600 active:bg-stone-100'}`}>
                          {label}
                        </button>
                      ))}
                      <button onClick={() => setPayDateRange('CUSTOM')}
                        className={`col-span-2 py-3.5 rounded-xl font-bold text-sm transition-all ${payDateRange === 'CUSTOM' ? 'bg-emerald-500 text-white shadow-lg' : 'bg-white border-2 border-stone-200 text-stone-600 active:bg-stone-100'}`}>
                        Custom Dates
                      </button>
                    </div>
                    {payDateRange === 'CUSTOM' && (
                      <div className="grid grid-cols-2 gap-3 mt-4">
                        <div>
                          <p className="text-xs font-bold text-stone-500 mb-1">From</p>
                          <input type="date" value={payStartDate} onChange={e => setPayStartDate(e.target.value)}
                            className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2.5 text-sm font-bold" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-stone-500 mb-1">To</p>
                          <input type="date" value={payEndDate} onChange={e => setPayEndDate(e.target.value)}
                            className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2.5 text-sm font-bold" />
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Filter by driver */}
                  <div className="bg-stone-50 rounded-2xl p-4">
                    <p className="text-xs font-bold uppercase text-stone-400 mb-2 text-center">Filter by Driver</p>
                    <select value={feeDriverFilter} onChange={e => setFeeDriverFilter(e.target.value)}
                      className="w-full bg-white border-2 border-stone-200 rounded-xl px-4 py-3 text-base font-bold outline-none focus:border-emerald-500">
                      <option value="ALL">🚗 All Drivers</option>
                      {allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
                        <option key={u.id} value={u.id}>👤 {u.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Results */}
                  {(() => {
                    const { start, end } = getDateRangeForPay();
                    const filtered = feeDriverFilter === 'ALL' 
                      ? deliveries.filter(d => d.status === 'DELIVERED' && d.completedAt && d.completedAt.split('T')[0] >= start && d.completedAt.split('T')[0] <= end)
                      : deliveries.filter(d => d.status === 'DELIVERED' && d.completedAt && d.completedAt.split('T')[0] >= start && d.completedAt.split('T')[0] <= end && d.driverId === feeDriverFilter);
                    const totalFees = filtered.reduce((sum, d) => sum + (d.deliveryFee || 0), 0);
                    const totalDeliveries = filtered.length;
                    
                    // Format dates nicely: Mar 1 - Apr 9, 2026
                    const formatDate = (d: string) => {
                      const [y, m, day] = d.split('-');
                      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      return `${months[parseInt(m) - 1]} ${parseInt(day)}`;
                    };
                    const year = end.split('-')[0];
                    const dateDisplay = start === end 
                      ? `${formatDate(start)}, ${year}`
                      : `${formatDate(start)} – ${formatDate(end)}, ${year}`;
                    
                    // CSV Download function
                    const downloadReport = () => {
                      const headers = ['Order #', 'Driver', 'City', 'Delivery Fee', 'Completed', 'Notes'];
                      const rows = filtered.map(d => [
                        d.orderNumber || d.id,
                        d.driverName || 'Unassigned',
                        d.address?.city || '',
                        (d.deliveryFee || 0).toFixed(2),
                        d.completedAt ? new Date(d.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '',
                        (d.deliveryInstructions || '').replace(/,/g, ';').replace(/\n/g, ' ').slice(0, 100)
                      ]);
                      const csvContent = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
                      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `delivery-report-${start}-to-${end}.csv`;
                      link.click();
                      URL.revokeObjectURL(url);
                    };
                    
                    return (
                      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-5 text-center shadow-xl">
                        <p className="text-emerald-100 text-xs uppercase font-bold mb-1">
                          {feeDriverFilter === 'ALL' ? 'All Drivers' : allUsers.find(u => u.id === feeDriverFilter)?.name}
                        </p>
                        <p className="text-emerald-200 text-sm mb-3">{dateDisplay}</p>
                        <div className="text-5xl font-black text-white mb-2">${totalFees.toFixed(2)}</div>
                        <div className="inline-block bg-white/20 rounded-full px-4 py-1 mb-3">
                          <span className="text-emerald-100 font-bold text-sm">{totalDeliveries} deliveries</span>
                        </div>
                        {totalDeliveries > 0 && (
                          <div>
                            <button 
                              onClick={downloadReport}
                              className="bg-white/20 hover:bg-white/30 text-white font-bold text-sm px-4 py-2 rounded-xl transition-colors"
                            >
                              📥 Download Report
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
              
              {/* ══════════ DRIVER EARNINGS TAB ══════════ */}
              {feesTab === 'PAY_CALC' && (
                <>
                  <div className="text-center mb-2">
                    <p className="text-stone-500 text-sm">Calculate what a driver earned</p>
                  </div>
                  
                  {/* Step 1: Pick a driver */}
                  <div className="bg-stone-50 rounded-2xl p-4">
                    <p className="text-xs font-bold uppercase text-stone-400 mb-2 text-center">Step 1: Pick Driver</p>
                    <select value={payDriverId} onChange={e => { 
                      setPayDriverId(e.target.value); 
                      setPayCalculated(false);
                      if (e.target.value && driverRates[e.target.value]) {
                        setPayRatePerDelivery(driverRates[e.target.value].toString());
                      } else {
                        setPayRatePerDelivery('');
                      }
                    }}
                      className="w-full bg-white border-2 border-stone-200 rounded-xl px-4 py-4 text-lg font-bold outline-none focus:border-emerald-500">
                      <option value="">-- Select a Driver --</option>
                      {allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  
                  {payDriverId && (
                    <>
                      {/* Step 2: Time period */}
                      <div className="bg-stone-50 rounded-2xl p-4">
                        <p className="text-xs font-bold uppercase text-stone-400 mb-3 text-center">Step 2: Time Period</p>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { key: 'TODAY', label: 'Today' },
                            { key: 'YESTERDAY', label: 'Yesterday' },
                            { key: 'THIS_WEEK', label: 'This Week' },
                            { key: 'LAST_WEEK', label: 'Last Week' },
                            { key: 'THIS_MONTH', label: 'This Month' },
                            { key: 'LAST_MONTH', label: 'Last Month' },
                          ] as const).map(({ key, label }) => (
                            <button key={key} onClick={() => { setPayDateRange(key as typeof payDateRange); setPayCalculated(false); }}
                              className={`py-2.5 rounded-xl font-bold text-xs transition-all ${payDateRange === key ? 'bg-emerald-500 text-white' : 'bg-white border border-stone-200 text-stone-600 active:bg-stone-100'}`}>
                              {label}
                            </button>
                          ))}
                          <button onClick={() => { setPayDateRange('CUSTOM'); setPayCalculated(false); }}
                            className={`col-span-2 py-2.5 rounded-xl font-bold text-xs transition-all ${payDateRange === 'CUSTOM' ? 'bg-emerald-500 text-white' : 'bg-white border border-stone-200 text-stone-600 active:bg-stone-100'}`}>
                            Custom Dates
                          </button>
                        </div>
                        {payDateRange === 'CUSTOM' && (
                          <div className="grid grid-cols-2 gap-3 mt-3">
                            <div>
                              <p className="text-xs font-bold text-stone-500 mb-1">From</p>
                              <input type="date" value={payStartDate} onChange={e => { setPayStartDate(e.target.value); setPayCalculated(false); }}
                                className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2 text-sm font-bold" />
                            </div>
                            <div>
                              <p className="text-xs font-bold text-stone-500 mb-1">To</p>
                              <input type="date" value={payEndDate} onChange={e => { setPayEndDate(e.target.value); setPayCalculated(false); }}
                                className="w-full bg-white border border-stone-300 rounded-lg px-3 py-2 text-sm font-bold" />
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Step 3: Rate per delivery */}
                      <div className="bg-stone-50 rounded-2xl p-4">
                        <p className="text-xs font-bold uppercase text-stone-400 mb-3 text-center">Step 3: $ Per Delivery</p>
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-3xl font-black text-stone-400">$</span>
                          <input type="number" inputMode="decimal" placeholder="" step="0.01"
                            value={payRatePerDelivery} onChange={e => { setPayRatePerDelivery(e.target.value); setPayCalculated(false); }}
                            className="w-32 bg-white border-2 border-stone-200 rounded-xl px-4 py-3 text-3xl font-black text-center outline-none focus:border-emerald-500" />
                        </div>
                        {payRatePerDelivery && parseFloat(payRatePerDelivery) !== driverRates[payDriverId] && (
                          <button onClick={() => handleSaveDriverRate(payDriverId, parseFloat(payRatePerDelivery))}
                            className="w-full mt-3 py-2 bg-blue-100 text-blue-700 rounded-xl text-xs font-bold">
                            💾 Save ${payRatePerDelivery} as {allUsers.find(u => u.id === payDriverId)?.name}'s rate
                          </button>
                        )}
                        {driverRates[payDriverId] && (
                          <p className="text-xs text-stone-400 mt-2 text-center">Saved rate: ${driverRates[payDriverId].toFixed(2)}</p>
                        )}
                      </div>
                      
                      {/* Bonus/Deduction (collapsible) */}
                      <details className="bg-stone-50 rounded-2xl overflow-hidden">
                        <summary className="p-4 cursor-pointer text-xs font-bold uppercase text-stone-400 text-center">
                          ➕ Add Bonus or Deduction
                        </summary>
                        <div className="px-4 pb-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-500 font-bold">+$</span>
                            <input type="number" inputMode="decimal" placeholder="0" step="0.01"
                              value={payBonus} onChange={e => { setPayBonus(e.target.value); setPayCalculated(false); }}
                              className="w-20 bg-white border border-stone-200 rounded-xl px-2 py-2 text-center font-bold outline-none" />
                            <input type="text" placeholder="Bonus reason"
                              value={payBonusNote} onChange={e => setPayBonusNote(e.target.value)}
                              className="flex-1 bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none" />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-red-500 font-bold">−$</span>
                            <input type="number" inputMode="decimal" placeholder="0" step="0.01"
                              value={payDeduction} onChange={e => { setPayDeduction(e.target.value); setPayCalculated(false); }}
                              className="w-20 bg-white border border-stone-200 rounded-xl px-2 py-2 text-center font-bold outline-none" />
                            <input type="text" placeholder="Deduction reason"
                              value={payDeductionNote} onChange={e => setPayDeductionNote(e.target.value)}
                              className="flex-1 bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none" />
                          </div>
                        </div>
                      </details>
                      
                      {/* Calculate button */}
                      <button onClick={() => { setPayCalculated(true); setTimeout(() => { payResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); }} 
                        disabled={!payRatePerDelivery && !driverRates[payDriverId]}
                        className={`w-full py-4 rounded-2xl font-black uppercase text-lg transition-all ${(!payRatePerDelivery && !driverRates[payDriverId]) ? 'bg-stone-200 text-stone-400' : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg active:scale-98'}`}>
                        Calculate Earnings
                      </button>
                      
                      {/* Results */}
                      {payCalculated && (() => {
                        const result = calculateDriverPay(payDriverId);
                        const driverName = allUsers.find(u => u.id === payDriverId)?.name || 'Driver';
                        const { start, end } = getDateRangeForPay();
                        return (
                          <div ref={payResultsRef} className="bg-gradient-to-br from-stone-900 to-stone-800 rounded-2xl p-5 space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-emerald-400 font-black text-lg">{driverName}</p>
                                <p className="text-stone-400 text-xs">{start} → {end}</p>
                              </div>
                              <div className="bg-emerald-500/20 px-3 py-1 rounded-full">
                                <span className="text-emerald-400 font-bold text-sm">{result.count} deliveries</span>
                              </div>
                            </div>
                            
                            <div className="space-y-1.5 pt-2 border-t border-stone-700 text-sm">
                              <div className="flex justify-between text-stone-300">
                                <span>{result.count} × ${result.rate.toFixed(2)}</span>
                                <span className="font-bold">${result.subtotal.toFixed(2)}</span>
                              </div>
                              {result.bonus > 0 && (
                                <div className="flex justify-between text-emerald-400">
                                  <span>+ Bonus {payBonusNote && `(${payBonusNote})`}</span>
                                  <span className="font-bold">+${result.bonus.toFixed(2)}</span>
                                </div>
                              )}
                              {result.deduction > 0 && (
                                <div className="flex justify-between text-red-400">
                                  <span>− Deduction {payDeductionNote && `(${payDeductionNote})`}</span>
                                  <span className="font-bold">−${result.deduction.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                            
                            <div className="pt-3 border-t border-stone-700 flex items-center justify-between">
                              <span className="text-stone-400 font-bold uppercase text-sm">Total Earnings</span>
                              <span className="text-4xl font-black text-white">${result.total.toFixed(2)}</span>
                            </div>
                            
                            <button onClick={saveFeeCalculation}
                              className="w-full py-3 bg-emerald-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:bg-emerald-600">
                              💾 Save to History
                            </button>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </>
              )}
              
              
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close driver menu */}
      {driverMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setDriverMenuOpen(null)} />}      {/* Click outside to close driver menu */}
      {driverMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setDriverMenuOpen(null)} />}
    </div>
  );
};




// ─────────────────────────────────────────────────────────────────────────────
// DRIVER HOME VIEW — Welcome screen with stats, delivery fee lookup, store info
// ─────────────────────────────────────────────────────────────────────────────

interface DriverHomeProps {
  currentUser: UserAccount;
  deliveries: Delivery[];
  onSelectOrder: (o: Delivery) => void;
}

const DriverHomeView: React.FC<DriverHomeProps> = ({ currentUser, deliveries, onSelectOrder }) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const isAdmin = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'MANAGER';
  const isDriver = currentUser.role === 'DRIVER';
  const firstName = currentUser.name.split(' ')[0];
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 17 ? 'Good afternoon' : 'Good evening';

  const shiftDate = (n: number) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + n);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const myDeliveries = isDriver
    ? deliveries.filter(d => d.driverId === currentUser.id)
    : deliveries;

  // Stats (all time / today)
  const todayDelivered = myDeliveries.filter(d =>
    d.status === DeliveryStatus.DELIVERED && (d.completedAt || '').startsWith(todayStr)
  );
  const allOpen = myDeliveries.filter(d =>
    ![DeliveryStatus.DELIVERED, DeliveryStatus.CLOSED].includes(d.status)
  );

  // Deliveries for the selected date
  const dateDeliveries = myDeliveries
    .filter(d => (d.deliveryDate || '').split('T')[0] === selectedDate)
    .sort((a, b) => (a.orderNumber || '').localeCompare(b.orderNumber || ''));

  const dateOpen = dateDeliveries.filter(d => ![DeliveryStatus.DELIVERED, DeliveryStatus.CLOSED].includes(d.status));
  const dateDone = dateDeliveries.filter(d => d.status === DeliveryStatus.DELIVERED);

  const fmtDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    const isToday = iso === todayStr;
    const isTomorrow = iso === tomorrowStr;
    if (isToday) return 'Today';
    if (isTomorrow) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  return (
    <div className="px-4 py-4 space-y-4 pb-28">
      {/* Welcome card */}
      <div className="bg-gradient-to-br from-stone-900 to-stone-800 rounded-[24px] px-5 py-5 text-white">
        <p className="text-stone-400 text-[10px] font-black uppercase tracking-widest">{greeting}</p>
        <h1 className="text-3xl font-black mt-0.5">{firstName}!</h1>
        <div className="flex items-center gap-3 mt-4">
          <div className="bg-white/10 rounded-2xl px-4 py-3 text-center flex-1">
            <p className="text-2xl font-black">{allOpen.length}</p>
            <p className="text-[9px] font-bold text-white/60 uppercase">Open</p>
          </div>
          <div className="bg-white/10 rounded-2xl px-4 py-3 text-center flex-1">
            <p className="text-2xl font-black text-green-400">{todayDelivered.length}</p>
            <p className="text-[9px] font-bold text-white/60 uppercase">Done Today</p>
          </div>
          <div className="bg-white/10 rounded-2xl px-4 py-3 text-center flex-1">
            <p className="text-2xl font-black text-amber-400">{dateOpen.length}</p>
            <p className="text-[9px] font-bold text-white/60 uppercase">{fmtDate(selectedDate) === 'Today' ? 'Left Today' : 'For ' + fmtDate(selectedDate).split(' ')[0]}</p>
          </div>
        </div>
      </div>

      {/* Date switcher */}
      <div className="flex items-center gap-2">
        <button onClick={() => shiftDate(-1)} className="w-11 h-11 bg-stone-100 rounded-xl flex items-center justify-center active:bg-stone-200 shrink-0">
          <ChevronLeft size={20} className="text-stone-700" />
        </button>
        <div className="flex-1 bg-stone-50 border-2 border-stone-200 rounded-xl py-2.5 text-center">
          <p className="font-black text-base text-stone-900">{fmtDate(selectedDate)}</p>
          <p className="text-[10px] text-stone-400 font-bold">{new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
        </div>
        <button onClick={() => shiftDate(1)} className="w-11 h-11 bg-stone-100 rounded-xl flex items-center justify-center active:bg-stone-200 shrink-0">
          <ChevronRight size={20} className="text-stone-700" />
        </button>
      </div>

      {/* Deliveries for selected date */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <Truck size={15} className="text-stone-600" />
          <h3 className="font-black uppercase text-xs tracking-widest text-stone-700">
            {fmtDate(selectedDate)} — {dateOpen.length} to deliver{dateDone.length > 0 ? `, ${dateDone.length} done` : ''}
          </h3>
        </div>
        {dateDeliveries.length === 0 ? (
          <div className="bg-stone-50 rounded-2xl py-10 text-center">
            <Package size={28} className="text-stone-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-stone-400">No deliveries for {fmtDate(selectedDate)}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dateDeliveries.map(d => {
              const isDone = d.status === DeliveryStatus.DELIVERED;
              const cleanNum = d.orderNumber?.replace(/^#+/, '') || d.id;
              const hasAlert = !!(d.deliveryInstructions || d.adminNotes);
              return (
                <button key={d.id} onClick={() => onSelectOrder(d)}
                  className={`w-full rounded-2xl px-4 py-3 active:scale-[0.98] transition-all text-left border ${isDone ? 'bg-green-50 border-green-100' : 'bg-white border-stone-100 shadow-sm'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isDone ? 'bg-green-500' : 'bg-stone-900'}`}>
                      {isDone ? <Check size={15} className="text-white" /> : <Package size={14} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <p className="font-black text-sm text-stone-900">#{cleanNum}</p>
                        <p className="text-sm font-black text-stone-700 truncate">{d.address?.city || '—'}</p>
                      </div>
                      <p className="text-[11px] text-stone-500 font-bold truncate">{d.giftReceiverName || d.customer?.name}</p>
                      <p className="text-[10px] text-stone-400 truncate">{d.address?.street}{d.address?.unit ? ` #${d.address.unit}` : ''}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {isDone
                        ? <span className="text-[10px] font-black text-green-600 bg-green-100 px-2 py-0.5 rounded-full">DONE ✓</span>
                        : <ChevronRight size={18} className="text-stone-300" />}
                    </div>
                  </div>
                  {hasAlert && (
                    <div className="mt-2 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      <AlertTriangle size={11} className="text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-[10px] font-black text-amber-800 leading-snug">
                        {[d.deliveryInstructions, d.adminNotes].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Store Info */}
      <div className="bg-stone-50 border border-stone-100 rounded-[24px] px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Store size={15} className="text-stone-600" />
          <h3 className="font-black uppercase text-xs tracking-widest text-stone-700">Store Info</h3>
        </div>
        <div className="space-y-2">
          <p className="font-black text-stone-900 text-sm">The Sweet Tooth — Chocolate Factory</p>
          <p className="font-bold text-stone-600 text-sm">18435 NE 19th Ave, North Miami Beach, FL 33179</p>
          <p className="font-bold text-stone-600 text-sm">(305) 682-1400</p>
          <p className="text-[10px] text-stone-400 font-bold uppercase">Mon–Fri 10AM–5PM · Same-day cutoff 2PM</p>
        </div>
      </div>
      <div className="h-4" />
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// BULK PROJECTS VIEW (Berkowitz / Provenance)
// ─────────────────────────────────────────────────────────────────────────────

interface BulkProject {
  id: string; name: string; clientName: string; createdAt: string;
  status: string; totalOrders: number; completedOrders: number;
}

interface BulkOrder {
  id: string; projectId: string; orderNumber: string; subBrand: 'BERKOWITZ' | 'PROVENANCE';
  recipientName: string; recipientPhone: string; street: string; unit: string;
  city: string; state: string; zip: string; addressType: string;
  deliveryPreference: string; basketType: string; deliveryFee: number;
  deliveryDate: string; workerName: string; companyName: string;
  status: string; driverId: string; driverName: string;
  confirmationPhoto?: string; confirmationSignature?: string;
  completedAt?: string; submittedAt?: string;
  failureReason?: string; failureNotes?: string; failurePhoto?: string;
  attemptNumber: 1 | 2; originalOrderId?: string; rescheduledDate?: string;
  adminNotes?: string; driverNotes?: string; createdAt: string;
}

const BULK_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  PENDING:             { label: 'Pending',            bg: 'bg-stone-800',   text: 'text-white' },
  ASSIGNED:            { label: 'Assigned',           bg: 'bg-blue-600',    text: 'text-white' },
  IN_TRANSIT:          { label: 'Out for Delivery',   bg: 'bg-black',       text: 'text-white' },
  DELIVERED:           { label: 'Delivered ✓',        bg: 'bg-green-600',   text: 'text-white' },
  FAILED:              { label: 'Failed',             bg: 'bg-red-600',     text: 'text-white' },
  SECOND_ATTEMPT:      { label: '2nd Attempt',        bg: 'bg-amber-600',   text: 'text-white' },
  PENDING_RESCHEDULE:  { label: 'Needs Reschedule',   bg: 'bg-amber-500',   text: 'text-white' },
  CLOSED:              { label: 'Closed',             bg: 'bg-stone-300',   text: 'text-stone-600' },
};

function BulkStatusBadge({ status }: { status: string }) {
  const cfg = BULK_STATUS_CONFIG[status] || BULK_STATUS_CONFIG.PENDING;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

const PREF_BADGE: Record<string, { bg: string; label: string }> = {
  Morning:   { bg: 'bg-yellow-100 text-yellow-800', label: '☀️ Morning' },
  Afternoon: { bg: 'bg-orange-100 text-orange-800', label: '🌤️ Afternoon' },
  Evening:   { bg: 'bg-indigo-100 text-indigo-800', label: '🌙 Evening' },
  Anytime:   { bg: 'bg-stone-100 text-stone-600',   label: '⏰ Anytime' },
};

const BulkProjectsView: React.FC<{
  currentUser: UserAccount;
  allUsers: UserAccount[];
}> = ({ currentUser, allUsers }) => {
  const isAdmin = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'MANAGER';
  const [projects, setProjects] = useState<BulkProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [orders, setOrders] = useState<BulkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'CALENDAR' | 'ALL_ORDERS' | 'FAILED' | 'FEES'>('CALENDAR');
  const [filter, setFilter] = useState<{ status?: string; driver?: string; brand?: string; pref?: string; zip?: string; search?: string }>({});
  const [sortBy, setSortBy] = useState<'orderNumber' | 'name' | 'zip' | 'city' | 'status' | 'driver'>('orderNumber');
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [detailOrder, setDetailOrder] = useState<BulkOrder | null>(null);
  const [showPOD, setShowPOD] = useState(false);
  const [podPhoto, setPodPhoto] = useState<string | null>(null);
  const [podSignature, setPodSignature] = useState<string | null>(null); // kept null-only so /api/bulk POD payload shape is unchanged
  const [showFailedFlow, setShowFailedFlow] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [failNotes, setFailNotes] = useState('');
  const [feeFilter, setFeeFilter] = useState<{ driver?: string; brand?: string; dateFrom?: string; dateTo?: string }>({});
  const [calendarDate, setCalendarDate] = useState(new Date().toISOString().split('T')[0]);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadProjects(); }, []);
  useEffect(() => { if (activeProjectId) loadOrders(activeProjectId); }, [activeProjectId]);

  const loadProjects = async () => {
    try {
      const r = await fetch('/api/bulk/projects');
      const d = await r.json();
      setProjects(d.projects || []);
      if (d.projects?.length > 0 && !activeProjectId) setActiveProjectId(d.projects[0].id);
    } catch (e) { console.error('Failed to load projects', e); }
    finally { setLoading(false); }
  };

  const loadOrders = async (projectId: string) => {
    try {
      const r = await fetch(`/api/bulk/projects/${projectId}/orders`);
      const d = await r.json();
      setOrders(d.orders || []);
    } catch (e) { console.error('Failed to load orders', e); }
  };

  // CSV Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    const rawHeaders = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    let headerIdx = 0;
    if (!rawHeaders.some(h => h.toLowerCase().includes('send gift basket')) && !rawHeaders.some(h => h === '#')) headerIdx = 1;
    const headers = headerIdx > 0 ? lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, '')) : rawHeaders;
    const isBerkowitz = headers.some(h => h === '#' || h === 'Worker');
    const subBrand: 'BERKOWITZ' | 'PROVENANCE' = isBerkowitz ? 'BERKOWITZ' : 'PROVENANCE';
    const prefix = isBerkowitz ? 'BRK' : 'PRV';
    const findCol = (kw: string[]) => headers.findIndex(h => kw.some(k => h.toLowerCase().includes(k.toLowerCase())));
    const colName = findCol(['Recipient Name']); const colPhone = findCol(['Recipient Phone']);
    const colStreet = findCol(['Recipient Street']); const colUnit = findCol(['Apt/Unit', 'Unit Number']);
    const colCity = findCol(['Recipient City']); const colState = findCol(['Recipient State']);
    const colZip = findCol(['Recipient Zip']); const colType = findCol(['Address Type']);
    const colPref = findCol(['Delivery Preference']); const colBasket = findCol(['Gift Basket Selection']);
    const colDeliveryType = findCol(['Delivery Type', 'Local Delivery or']); const colFee = findCol(['Delivery Fee']);
    const colWorker = findCol(['Worker']); const colCompany = findCol(['Company']); const colNumber = findCol(['#']);
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = []; let current = ''; let inQ = false;
      for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { result.push(current.trim()); current = ''; } else current += ch; }
      result.push(current.trim()); return result;
    };
    const dataLines = lines.slice(headerIdx + 1); const parsedOrders: BulkOrder[] = []; let orderNum = 1;
    for (const line of dataLines) {
      if (!line.trim()) continue;
      const cols = parseCSVLine(line);
      const name = cols[colName] || ''; if (!name || name.toLowerCase() === 'nan') continue;
      const deliveryType = colDeliveryType >= 0 ? (cols[colDeliveryType] || '') : '';
      if (deliveryType && !deliveryType.toLowerCase().includes('local')) continue;
      const feeStr = colFee >= 0 ? (cols[colFee] || '$0') : '$0';
      const fee = parseInt(feeStr.replace(/[^0-9]/g, '')) || 0;
      const num = colNumber >= 0 ? (cols[colNumber] || String(orderNum)) : String(orderNum);
      const unit = cols[colUnit] || ''; const phone = (cols[colPhone] || '').replace(/[^0-9]/g, '');
      const zip = String(cols[colZip] || '').replace(/\.0$/, '').padStart(5, '0');
      parsedOrders.push({
        id: `${prefix.toLowerCase()}_${Date.now()}_${orderNum}`, projectId: activeProjectId || '',
        orderNumber: `${prefix}-${String(num).padStart(3, '0')}`, subBrand,
        recipientName: name, recipientPhone: phone === 'nan' ? '' : phone,
        street: cols[colStreet] || '', unit: unit === 'nan' ? '' : unit,
        city: cols[colCity] || '', state: cols[colState] || '', zip,
        addressType: (cols[colType] || 'Residence'), deliveryPreference: (cols[colPref] || 'Anytime'),
        basketType: cols[colBasket] || 'Standard Chocolate Basket', deliveryFee: fee,
        deliveryDate: '', workerName: colWorker >= 0 ? (cols[colWorker] || '') : '',
        companyName: colCompany >= 0 ? (cols[colCompany] || subBrand) : subBrand,
        status: 'PENDING', driverId: '', driverName: '', attemptNumber: 1, createdAt: new Date().toISOString(),
      });
      orderNum++;
    }
    if (parsedOrders.length === 0) { alert('No local delivery orders found.'); return; }
    let projectId = activeProjectId;
    if (!projectId) {
      const r = await fetch('/api/bulk/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Berkowitz 2026', clientName: 'Berkowitz' }) });
      const d = await r.json(); projectId = d.project.id; setActiveProjectId(projectId);
    }
    parsedOrders.forEach(o => o.projectId = projectId!);
    const r = await fetch(`/api/bulk/projects/${projectId}/orders/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orders: parsedOrders }) });
    const d = await r.json();
    alert(`Imported ${d.totalImported} ${subBrand} local deliveries!`);
    loadOrders(projectId!); loadProjects(); setShowUpload(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const assignDriver = async (driverId: string, driverName: string) => {
    if (!activeProjectId || selectedOrders.size === 0) return;
    await fetch(`/api/bulk/orders/${activeProjectId}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: Array.from(selectedOrders), driverId, driverName }) });
    setSelectedOrders(new Set()); setShowAssignModal(false); loadOrders(activeProjectId);
  };

  const scheduleOrders = async (date: string) => {
    if (!activeProjectId || selectedOrders.size === 0 || !date) return;
    for (const oid of Array.from(selectedOrders)) {
      await fetch(`/api/bulk/orders/${activeProjectId}/${oid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryDate: date }) });
    }
    setSelectedOrders(new Set()); setShowScheduleModal(false); setScheduleDate(''); loadOrders(activeProjectId);
  };

  const updateOrder = async (orderId: string, updates: Partial<BulkOrder>) => {
    if (!activeProjectId) return;
    await fetch(`/api/bulk/orders/${activeProjectId}/${orderId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    loadOrders(activeProjectId);
  };

  const submitPOD = async (orderId: string, status: string) => {
    if (!activeProjectId) return;
    await fetch(`/api/bulk/orders/${activeProjectId}/${orderId}/pod`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photo: podPhoto, signature: podSignature, status, driverId: currentUser.id, driverName: currentUser.name, failureReason: status === 'FAILED' ? failReason : undefined, notes: status === 'FAILED' ? failNotes : undefined }) });
    setPodPhoto(null); setPodSignature(null); setShowPOD(false); setShowFailedFlow(false); setFailReason(''); setFailNotes(''); setDetailOrder(null);
    loadOrders(activeProjectId); loadProjects();
  };

  const rescheduleOrder = async (orderId: string, overrideDate?: string) => {
    if (!activeProjectId) return;
    await fetch(`/api/bulk/orders/${activeProjectId}/${orderId}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overrideDate }) });
    loadOrders(activeProjectId); loadProjects();
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader(); reader.onload = () => setPodPhoto(reader.result as string); reader.readAsDataURL(file);
  };

  // Computed
  const drivers = useMemo(() => allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive), [allUsers]);

  const stats = useMemo(() => {
    const nonClosed = orders.filter(o => o.status !== 'CLOSED');
    const delivered = nonClosed.filter(o => o.status === 'DELIVERED');
    const failed = nonClosed.filter(o => o.status === 'FAILED' || o.status === 'SECOND_ATTEMPT' || o.status === 'PENDING_RESCHEDULE');
    const berkowitz = nonClosed.filter(o => o.subBrand === 'BERKOWITZ');
    const provenance = nonClosed.filter(o => o.subBrand === 'PROVENANCE');
    const remaining = nonClosed.filter(o => o.status !== 'DELIVERED');
    const scheduled = nonClosed.filter(o => o.deliveryDate && o.deliveryDate !== '');
    const unscheduled = nonClosed.filter(o => !o.deliveryDate || o.deliveryDate === '');
    return {
      total: nonClosed.length, delivered: delivered.length, remaining: remaining.length,
      failed: failed.length, berkowitz: berkowitz.length, provenance: provenance.length,
      berkowitzDelivered: berkowitz.filter(o => o.status === 'DELIVERED').length,
      provenanceDelivered: provenance.filter(o => o.status === 'DELIVERED').length,
      scheduled: scheduled.length, unscheduled: unscheduled.length,
      totalFees: delivered.reduce((s, o) => s + o.deliveryFee, 0),
    };
  }, [orders]);

  // Orders for selected calendar date
  const calendarOrders = useMemo(() => {
    let result = orders.filter(o => o.deliveryDate === calendarDate && o.status !== 'CLOSED');
    if (!isAdmin) result = result.filter(o => o.driverId === currentUser.id);
    return result;
  }, [orders, calendarDate, isAdmin, currentUser.id]);

  // Unscheduled orders
  const unscheduledOrders = useMemo(() => {
    return orders.filter(o => (!o.deliveryDate || o.deliveryDate === '') && o.status !== 'CLOSED' && o.status !== 'DELIVERED');
  }, [orders]);

  // All orders filtered (for ALL_ORDERS view)
  const filteredOrders = useMemo(() => {
    let result = orders.filter(o => o.status !== 'CLOSED');
    if (!isAdmin) result = result.filter(o => o.driverId === currentUser.id);
    if (filter.status) result = result.filter(o => o.status === filter.status);
    if (filter.driver) result = result.filter(o => o.driverId === filter.driver);
    if (filter.brand) result = result.filter(o => o.subBrand === filter.brand);
    if (filter.pref) result = result.filter(o => o.deliveryPreference === filter.pref);
    if (filter.zip) result = result.filter(o => o.zip.startsWith(filter.zip!));
    if (filter.search) {
      const s = filter.search.toLowerCase();
      result = result.filter(o => o.recipientName.toLowerCase().includes(s) || o.orderNumber.toLowerCase().includes(s) || o.street.toLowerCase().includes(s) || o.city.toLowerCase().includes(s) || o.zip.includes(s));
    }
    result.sort((a, b) => {
      if (sortBy === 'name') return a.recipientName.localeCompare(b.recipientName);
      if (sortBy === 'zip') return a.zip.localeCompare(b.zip);
      if (sortBy === 'city') return a.city.localeCompare(b.city);
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      if (sortBy === 'driver') return (a.driverName || '').localeCompare(b.driverName || '');
      return a.orderNumber.localeCompare(b.orderNumber);
    });
    return result;
  }, [orders, filter, sortBy, isAdmin, currentUser.id]);

  const failedOrders = useMemo(() => orders.filter(o => o.status === 'FAILED' || o.status === 'SECOND_ATTEMPT' || o.status === 'PENDING_RESCHEDULE'), [orders]);

  const feeSummary = useMemo(() => {
    let feeable = orders.filter(o => o.status === 'DELIVERED');
    if (feeFilter.driver) feeable = feeable.filter(o => o.driverId === feeFilter.driver);
    if (feeFilter.brand) feeable = feeable.filter(o => o.subBrand === feeFilter.brand);
    if (feeFilter.dateFrom) feeable = feeable.filter(o => (o.completedAt || '') >= feeFilter.dateFrom!);
    if (feeFilter.dateTo) feeable = feeable.filter(o => (o.completedAt || '') <= feeFilter.dateTo! + 'T23:59:59');
    const byDriver: Record<string, { count: number; total: number }> = {};
    const byBrand: Record<string, { count: number; total: number }> = {};
    for (const o of feeable) {
      const dn = o.driverName || 'Unassigned';
      if (!byDriver[dn]) byDriver[dn] = { count: 0, total: 0 }; byDriver[dn].count++; byDriver[dn].total += o.deliveryFee;
      if (!byBrand[o.subBrand]) byBrand[o.subBrand] = { count: 0, total: 0 }; byBrand[o.subBrand].count++; byBrand[o.subBrand].total += o.deliveryFee;
    }
    return { deliveries: feeable, byDriver, byBrand, grandTotal: feeable.reduce((s, o) => s + o.deliveryFee, 0) };
  }, [orders, feeFilter]);

  // Dates that have orders scheduled
  const scheduledDates = useMemo(() => {
    const dates: Record<string, { total: number; delivered: number; failed: number }> = {};
    for (const o of orders) {
      if (!o.deliveryDate || o.status === 'CLOSED') continue;
      if (!dates[o.deliveryDate]) dates[o.deliveryDate] = { total: 0, delivered: 0, failed: 0 };
      dates[o.deliveryDate].total++;
      if (o.status === 'DELIVERED') dates[o.deliveryDate].delivered++;
      if (o.status === 'FAILED' || o.status === 'PENDING_RESCHEDULE') dates[o.deliveryDate].failed++;
    }
    return dates;
  }, [orders]);

  if (loading) return <div className="p-8 text-center text-stone-400 font-bold">Loading...</div>;

  // ── ORDER DETAIL ──
  if (detailOrder) {
    const fresh = orders.find(ord => ord.id === detailOrder.id) || detailOrder;

    if (showPOD) {
      return (
        <div className="min-h-screen bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => { setShowPOD(false); setPodPhoto(null); setPodSignature(null); }} className="flex items-center gap-1 text-stone-500 font-bold text-sm"><ChevronLeft size={16} /> Back</button>
            <p className="font-black text-lg">Proof of Delivery</p>
            <div className="w-16" />
          </div>
          <div className="bg-stone-50 rounded-2xl p-4 mb-4">
            <p className="font-black text-lg">{fresh.recipientName}</p>
            <p className="text-stone-500 text-sm">{fresh.street}{fresh.unit ? `, ${fresh.unit}` : ''}, {fresh.city} {fresh.zip}</p>
          </div>
          <div className="mb-4">
            <p className="font-black text-sm mb-2 uppercase text-stone-500">📸 Photo (Required)</p>
            {podPhoto ? (
              <div className="relative">
                <img src={podPhoto} alt="POD" className="w-full rounded-xl max-h-48 object-cover" />
                <button onClick={() => setPodPhoto(null)} className="absolute top-2 right-2 bg-red-500 text-white w-7 h-7 rounded-full flex items-center justify-center"><X size={14} /></button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => cameraInputRef.current?.click()} className="w-full py-6 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 font-bold flex flex-col items-center gap-1">
                  <Camera size={22} /><span className="text-xs">Take Photo</span>
                </button>
                <button onClick={() => photoInputRef.current?.click()} className="w-full py-6 border-2 border-dashed border-stone-300 rounded-xl text-stone-500 font-bold flex flex-col items-center gap-1">
                  <span style={{ fontSize: 20 }}>🖼️</span><span className="text-xs">Upload</span>
                </button>
              </div>
            )}
            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoCapture} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
          </div>
          <button onClick={() => submitPOD(fresh.id, 'DELIVERED')} disabled={!podPhoto}
            className={`w-full py-4 rounded-2xl font-black text-lg uppercase tracking-wide transition-all ${podPhoto ? 'bg-green-600 text-white active:scale-95' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}>
            {podPhoto ? '✓ CONFIRM DELIVERED' : 'Photo Required'}
          </button>
        </div>
      );
    }

    if (showFailedFlow) {
      return (
        <div className="min-h-screen bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setShowFailedFlow(false)} className="flex items-center gap-1 text-stone-500 font-bold text-sm"><ChevronLeft size={16} /> Back</button>
            <p className="font-black text-lg text-red-600">Report Failed</p>
            <div className="w-16" />
          </div>
          <div className="bg-red-50 rounded-2xl p-4 mb-4 border border-red-100">
            <p className="font-black text-lg">{fresh.recipientName}</p>
            <p className="text-stone-500 text-sm">{fresh.street}, {fresh.city}</p>
          </div>
          <p className="font-black text-sm mb-2 uppercase text-stone-500">Reason</p>
          {Object.entries(FAILURE_REASON_LABELS).map(([key, label]) => (
            <button key={key} onClick={() => setFailReason(key)}
              className={`w-full text-left px-4 py-3 mb-2 rounded-xl border-2 font-bold text-sm transition-all ${failReason === key ? 'border-red-500 bg-red-50 text-red-700' : 'border-stone-200 text-stone-600'}`}>
              {label}
            </button>
          ))}
          <textarea value={failNotes} onChange={e => setFailNotes(e.target.value)} placeholder="Details..." className="w-full border border-stone-200 rounded-xl p-3 text-sm min-h-[80px] mb-4 mt-2" />
          <button onClick={() => submitPOD(fresh.id, 'FAILED')} disabled={!failReason}
            className={`w-full py-4 rounded-2xl font-black text-lg uppercase ${failReason ? 'bg-red-600 text-white active:scale-95' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}>
            Submit Failed Delivery
          </button>
        </div>
      );
    }

    // Order detail view
    return (
      <div className="min-h-screen bg-white">
        <div className="sticky top-0 z-40 bg-white border-b border-stone-100 px-4 py-3 flex items-center justify-between shadow-sm">
          <button onClick={() => setDetailOrder(null)} className="flex items-center gap-1 text-stone-500 font-bold text-sm"><ChevronLeft size={16} /> Back</button>
          <p className="font-black text-sm">{fresh.orderNumber}</p>
          <BulkStatusBadge status={fresh.status} />
        </div>
        <div className="p-4 space-y-3">
          <div className={`inline-flex items-center px-3 py-1.5 rounded-xl font-black text-sm uppercase ${fresh.subBrand === 'BERKOWITZ' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
            {fresh.subBrand}
          </div>
          <div className="bg-stone-50 rounded-2xl p-4">
            <p className="text-[10px] font-black uppercase text-stone-400 mb-1">Recipient</p>
            <p className="font-black text-2xl text-black leading-tight">{fresh.recipientName}</p>
            <p className="text-stone-600 text-sm mt-1">{fresh.street}{fresh.unit ? `, ${fresh.unit}` : ''}</p>
            <p className="text-stone-600 text-sm">{fresh.city}, {fresh.state} {fresh.zip}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PREF_BADGE[fresh.deliveryPreference]?.bg || 'bg-stone-100'}`}>
                {PREF_BADGE[fresh.deliveryPreference]?.label || fresh.deliveryPreference}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">{fresh.addressType}</span>
            </div>
            {fresh.recipientPhone && <div className="mt-2"><ContactCallReveal phone={fresh.recipientPhone} label="Recipient" /></div>}
          </div>
          <div className="bg-amber-50 rounded-2xl p-3 border border-amber-100">
            <p className="font-bold text-sm text-amber-900">🎁 {fresh.basketType}</p>
          </div>
          {fresh.driverName && (
            <div className="bg-blue-50 rounded-2xl p-3 border border-blue-100">
              <p className="text-[10px] font-black uppercase text-blue-500">Driver</p>
              <p className="font-bold text-sm">{fresh.driverName}</p>
            </div>
          )}
          {isAdmin && (
            <div className="bg-green-50 rounded-2xl p-3 border border-green-100 flex justify-between items-center">
              <div><p className="text-[10px] font-black uppercase text-green-600">Delivery Fee</p><p className="font-black text-xl text-green-700">${fresh.deliveryFee}</p></div>
              <div className="text-right"><p className="text-[10px] font-black uppercase text-stone-400">Employee</p><p className="font-bold text-sm text-stone-600">{fresh.workerName || '—'}</p></div>
            </div>
          )}
          {fresh.status === 'DELIVERED' && fresh.confirmationPhoto && (
            <div className="bg-green-50 rounded-2xl p-4 border border-green-200">
              <p className="text-[10px] font-black uppercase text-green-600 mb-2">Proof of Delivery</p>
              <img src={fresh.confirmationPhoto} alt="POD" className="w-full rounded-xl max-h-48 object-cover mb-2" />
              {fresh.confirmationSignature && <img src={fresh.confirmationSignature} alt="Sig" className="w-full rounded-xl bg-white border border-green-200 max-h-24" />}
              {fresh.completedAt && <p className="text-xs text-green-600 mt-2 font-bold">Completed: {formatDate(fresh.completedAt)} at {formatTime(fresh.completedAt)}</p>}
            </div>
          )}
          {!isAdmin && (
            <div className="bg-blue-50 rounded-2xl p-3 border border-blue-100">
              <p className="text-[10px] font-black uppercase text-blue-600 mb-2">Need Help?</p>
              <ContactCallReveal phone="3059944070" label="Katie (Manager)" />
            </div>
          )}
          <button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${fresh.street}, ${fresh.city}, ${fresh.state} ${fresh.zip}`)}`, '_blank')}
            className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 text-white rounded-2xl font-black text-sm active:scale-95">
            <Navigation size={16} /> Navigate
          </button>
          {/* BIG POD BUTTONS */}
          {fresh.status !== 'DELIVERED' && fresh.status !== 'CLOSED' && (
            <div className="space-y-2">
              <button onClick={() => setShowPOD(true)}
                className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-lg flex items-center justify-center gap-3 active:scale-95 shadow-lg">
                <Camera size={22} /> 📸 DELIVER — Take Photo
              </button>
              <button onClick={() => setShowFailedFlow(true)}
                className="w-full py-3 bg-red-100 text-red-600 rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95">
                <XCircle size={16} /> Report Failed Delivery
              </button>
            </div>
          )}
          {isAdmin && (fresh.status === 'FAILED' || fresh.status === 'PENDING_RESCHEDULE') && (
            <div className="space-y-2">
              <button onClick={() => rescheduleOrder(fresh.id)} className="w-full py-3 bg-amber-500 text-white rounded-2xl font-black text-sm active:scale-95">↻ Reschedule Next Business Day</button>
              <div className="flex gap-2 items-center">
                <input type="date" className="flex-1 border border-stone-200 rounded-xl px-3 py-2 text-sm" onChange={e => { if (e.target.value) rescheduleOrder(fresh.id, e.target.value); }} />
                <span className="text-xs text-stone-400 font-bold">or pick date</span>
              </div>
            </div>
          )}
          {isAdmin && fresh.status !== 'DELIVERED' && fresh.status !== 'CLOSED' && (
            <div className="bg-stone-50 rounded-2xl p-3 space-y-3">
              <div>
                <p className="text-[10px] font-black uppercase text-stone-400 mb-1">Schedule Date</p>
                <input type="date" value={fresh.deliveryDate || ''} onChange={e => updateOrder(fresh.id, { deliveryDate: e.target.value })}
                  className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm font-bold" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-stone-400 mb-1">Assign Driver</p>
                <select value={fresh.driverId} onChange={e => { const d = drivers.find(d => d.id === e.target.value); if (d) updateOrder(fresh.id, { driverId: d.id, driverName: d.name, status: 'ASSIGNED' }); }}
                  className="w-full border border-stone-200 rounded-xl px-3 py-2 text-sm font-bold">
                  <option value="">Select driver...</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {fresh.adminNotes && <div className="bg-stone-50 rounded-2xl p-3"><p className="text-[10px] font-black uppercase text-stone-400 mb-1">Notes</p><p className="text-sm text-stone-600 whitespace-pre-wrap">{fresh.adminNotes}</p></div>}
        </div>
      </div>
    );
  }

  // ── MAIN VIEW ──
  // Helper to render an order card
  const renderOrderCard = (o: BulkOrder, showCheckbox: boolean) => (
    <div key={o.id} className={`mb-2 bg-white border rounded-2xl overflow-hidden transition-all ${selectedOrders.has(o.id) ? 'border-blue-500 bg-blue-50' : 'border-stone-100'}`}>
      <div className="flex items-center">
        {showCheckbox && isAdmin && (
          <button onClick={() => { const next = new Set(selectedOrders); next.has(o.id) ? next.delete(o.id) : next.add(o.id); setSelectedOrders(next); }} className="pl-3 pr-1 py-3">
            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${selectedOrders.has(o.id) ? 'bg-blue-600 border-blue-600' : 'border-stone-300'}`}>
              {selectedOrders.has(o.id) && <Check size={12} className="text-white" />}
            </div>
          </button>
        )}
        <button onClick={() => setDetailOrder(o)} className="flex-1 px-3 py-3 text-left">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-black text-xs text-stone-400">{o.orderNumber}</span>
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${o.subBrand === 'BERKOWITZ' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                {o.subBrand === 'BERKOWITZ' ? 'BRK' : 'PRV'}
              </span>
            </div>
            <BulkStatusBadge status={o.status} />
          </div>
          <p className="font-black text-base leading-tight">{o.recipientName}</p>
          <p className="text-xs text-stone-500 leading-tight">{o.street}, {o.city} {o.zip}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${PREF_BADGE[o.deliveryPreference]?.bg || 'bg-stone-100'}`}>{o.deliveryPreference}</span>
            {o.driverName && <span className="text-[9px] font-bold text-blue-600">🚗 {o.driverName}</span>}
            {o.addressType === 'Apartment' && <span className="text-[9px] font-bold text-stone-400">🏢 Apt</span>}
            {o.addressType === 'Business' && <span className="text-[9px] font-bold text-stone-400">🏢 Biz</span>}
          </div>
        </button>
        <ChevronRight size={16} className="text-stone-300 mr-3" />
      </div>
    </div>
  );

  return (
    <div className="pb-4">
      {/* Header with running totals */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[10px] font-black uppercase text-stone-400">Bulk Project</p>
            <p className="font-black text-xl">Berkowitz 2026</p>
          </div>
          {isAdmin && (
            <button onClick={() => setShowUpload(true)} className="flex items-center gap-1.5 px-3 py-2 bg-black text-white rounded-xl font-black text-[10px] uppercase active:scale-95">
              <FileText size={12} /> Upload CSV
            </button>
          )}
        </div>
        {showUpload && (
          <div className="mb-3 bg-stone-50 rounded-2xl p-4 border border-stone-200">
            <p className="font-bold text-sm mb-2">Upload Berkowitz or Provenance CSV</p>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload}
              className="w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:font-bold file:bg-black file:text-white" />
            <button onClick={() => setShowUpload(false)} className="mt-2 text-xs text-stone-400 font-bold">Cancel</button>
          </div>
        )}

        {/* Running totals — big and clear */}
        <div className="bg-stone-50 rounded-2xl p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-black text-3xl">{stats.remaining} <span className="text-base text-stone-400 font-bold">remaining</span></p>
            <p className="text-right text-sm font-bold text-stone-500">of {stats.total} total</p>
          </div>
          <div className="w-full bg-stone-200 rounded-full h-3 mb-3">
            <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${stats.total > 0 ? (stats.delivered / stats.total * 100) : 0}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center"><p className="font-black text-lg text-green-600">{stats.delivered}</p><p className="text-[9px] font-black uppercase text-green-600">Delivered</p></div>
            <div className="text-center cursor-pointer" onClick={() => setView('FAILED')}><p className="font-black text-lg text-red-600">{stats.failed}</p><p className="text-[9px] font-black uppercase text-red-600">Failed</p></div>
            <div className="text-center"><p className="font-black text-lg text-amber-600">{stats.unscheduled}</p><p className="text-[9px] font-black uppercase text-amber-600">Unscheduled</p></div>
          </div>
        </div>

        {/* Company breakdown */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-blue-50 rounded-xl p-3 text-center">
            <p className="font-black text-xs text-blue-600 uppercase">Berkowitz</p>
            <p className="font-black text-xl">{stats.berkowitz} <span className="text-sm text-stone-400">orders</span></p>
            <p className="text-xs font-bold text-green-600">{stats.berkowitzDelivered} delivered</p>
          </div>
          <div className="bg-purple-50 rounded-xl p-3 text-center">
            <p className="font-black text-xs text-purple-600 uppercase">Provenance</p>
            <p className="font-black text-xl">{stats.provenance} <span className="text-sm text-stone-400">orders</span></p>
            <p className="text-xs font-bold text-green-600">{stats.provenanceDelivered} delivered</p>
          </div>
        </div>

        {isAdmin && stats.totalFees > 0 && (
          <button onClick={() => setView('FEES')} className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-100 rounded-xl mb-3 w-full justify-center">
            <DollarSign size={12} className="text-green-600" />
            <span className="font-black text-sm text-green-700">${stats.totalFees} earned</span>
          </button>
        )}

        {/* View tabs */}
        <div className="flex gap-1 mb-3">
          {(['CALENDAR', 'ALL_ORDERS', 'FAILED', ...(isAdmin ? ['FEES'] as const : [])] as const).map(v => (
            <button key={v} onClick={() => setView(v as any)}
              className={`flex-1 py-2 rounded-xl font-black text-[10px] uppercase transition-all ${view === v ? 'bg-black text-white' : 'bg-stone-100 text-stone-500'}`}>
              {v === 'CALENDAR' ? '📅 Schedule' : v === 'ALL_ORDERS' ? 'All Orders' : v === 'FAILED' ? `Failed (${failedOrders.length})` : 'Fees'}
            </button>
          ))}
        </div>
      </div>

      {/* ── CALENDAR / SCHEDULE VIEW ── */}
      {view === 'CALENDAR' && (
        <div className="px-4">
          {/* Date picker */}
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => { const d = new Date(calendarDate); d.setDate(d.getDate() - 1); setCalendarDate(d.toISOString().split('T')[0]); }}
              className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center font-black"><ChevronLeft size={18} /></button>
            <input type="date" value={calendarDate} onChange={e => setCalendarDate(e.target.value)}
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-center font-black text-sm" />
            <button onClick={() => { const d = new Date(calendarDate); d.setDate(d.getDate() + 1); setCalendarDate(d.toISOString().split('T')[0]); }}
              className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center font-black"><ChevronRight size={18} /></button>
          </div>

          {/* Quick date pills — show dates that have orders */}
          {Object.keys(scheduledDates).length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto mb-3 pb-1" style={{ scrollbarWidth: 'none' }}>
              {Object.entries(scheduledDates).sort(([a], [b]) => a.localeCompare(b)).map(([date, info]: [string, any]) => (
                <button key={date} onClick={() => setCalendarDate(date)}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs whitespace-nowrap ${date === calendarDate ? 'bg-black text-white' : 'bg-stone-100 text-stone-600'}`}>
                  {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  <span className="ml-1 text-[9px]">({info.delivered}/{info.total})</span>
                </button>
              ))}
            </div>
          )}

          {/* Day summary */}
          <div className="bg-stone-50 rounded-2xl p-3 mb-3">
            <p className="font-black text-sm">{new Date(calendarDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            <p className="text-sm font-bold text-stone-500">{calendarOrders.length} deliveries scheduled</p>
            {calendarOrders.length > 0 && (
              <div className="flex gap-3 mt-1">
                {Array.from(new Set(calendarOrders.map(o => o.driverName).filter(Boolean))).map(dn => (
                  <span key={dn} className="text-xs font-bold text-blue-600">🚗 {dn} ({calendarOrders.filter(o => o.driverName === dn).length})</span>
                ))}
              </div>
            )}
          </div>

          {/* Bulk actions bar */}
          {isAdmin && selectedOrders.size > 0 && (
            <div className="bg-black text-white rounded-2xl p-3 mb-3 flex items-center justify-between">
              <span className="font-black text-sm">{selectedOrders.size} selected</span>
              <div className="flex gap-2">
                <button onClick={() => setShowScheduleModal(true)} className="px-3 py-1.5 bg-amber-500 rounded-xl font-black text-[10px] uppercase active:scale-95">📅 Schedule</button>
                <button onClick={() => setShowAssignModal(true)} className="px-3 py-1.5 bg-blue-600 rounded-xl font-black text-[10px] uppercase active:scale-95">🚗 Assign</button>
                <button onClick={() => setSelectedOrders(new Set())} className="px-3 py-1.5 bg-stone-700 rounded-xl font-black text-[10px] uppercase">Clear</button>
              </div>
            </div>
          )}

          {/* Orders for this date */}
          {calendarOrders.length > 0 ? calendarOrders.map(o => renderOrderCard(o, true)) : (
            <div className="text-center py-8 text-stone-400">
              <Calendar size={32} className="mx-auto mb-2 opacity-50" />
              <p className="font-bold">No deliveries scheduled for this date</p>
            </div>
          )}

          {/* Unscheduled orders toggle */}
          {isAdmin && unscheduledOrders.length > 0 && (
            <div className="mt-4">
              <button onClick={() => setShowUnscheduled(!showUnscheduled)}
                className="w-full py-3 bg-amber-50 border border-amber-200 rounded-2xl font-black text-sm text-amber-700 active:scale-95">
                {showUnscheduled ? '▼' : '▶'} {unscheduledOrders.length} Unscheduled Orders — Tap to {showUnscheduled ? 'Hide' : 'Schedule'}
              </button>
              {showUnscheduled && (
                <div className="mt-2">
                  {isAdmin && (
                    <button onClick={() => {
                      if (selectedOrders.size === unscheduledOrders.length) setSelectedOrders(new Set());
                      else setSelectedOrders(new Set(unscheduledOrders.map(o => o.id)));
                    }} className="text-[10px] font-black uppercase text-stone-400 mb-2 block">
                      {selectedOrders.size === unscheduledOrders.length ? '✓ Deselect All' : `Select All (${unscheduledOrders.length})`}
                    </button>
                  )}
                  {unscheduledOrders.map(o => renderOrderCard(o, true))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ALL ORDERS VIEW ── */}
      {view === 'ALL_ORDERS' && (
        <div className="px-4">
          <input type="text" placeholder="Search name, address, order #, zip..."
            value={filter.search || ''} onChange={e => setFilter(f => ({ ...f, search: e.target.value || undefined }))}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-bold mb-2 outline-none focus:border-black" />
          <div className="flex gap-1.5 overflow-x-auto mb-2 pb-1" style={{ scrollbarWidth: 'none' }}>
            <select value={filter.status || ''} onChange={e => setFilter(f => ({ ...f, status: e.target.value || undefined }))} className="bg-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase min-w-fit">
              <option value="">All Status</option>
              {Object.entries(BULK_STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {isAdmin && <select value={filter.driver || ''} onChange={e => setFilter(f => ({ ...f, driver: e.target.value || undefined }))} className="bg-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase min-w-fit">
              <option value="">All Drivers</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>}
            <select value={filter.brand || ''} onChange={e => setFilter(f => ({ ...f, brand: e.target.value || undefined }))} className="bg-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase min-w-fit">
              <option value="">All Companies</option><option value="BERKOWITZ">Berkowitz</option><option value="PROVENANCE">Provenance</option>
            </select>
            <select value={filter.pref || ''} onChange={e => setFilter(f => ({ ...f, pref: e.target.value || undefined }))} className="bg-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase min-w-fit">
              <option value="">All Prefs</option><option value="Morning">Morning</option><option value="Afternoon">Afternoon</option><option value="Evening">Evening</option><option value="Anytime">Anytime</option>
            </select>
          </div>
          <div className="flex gap-1.5 mb-3">
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase flex-1">
              <option value="orderNumber">Sort: Order #</option><option value="name">Sort: Name</option><option value="zip">Sort: ZIP</option>
              <option value="city">Sort: City</option><option value="status">Sort: Status</option><option value="driver">Sort: Driver</option>
            </select>
          </div>
          {isAdmin && selectedOrders.size > 0 && (
            <div className="bg-black text-white rounded-2xl p-3 mb-3 flex items-center justify-between">
              <span className="font-black text-sm">{selectedOrders.size} selected</span>
              <div className="flex gap-2">
                <button onClick={() => setShowScheduleModal(true)} className="px-3 py-1.5 bg-amber-500 rounded-xl font-black text-[10px] uppercase active:scale-95">📅 Schedule</button>
                <button onClick={() => setShowAssignModal(true)} className="px-3 py-1.5 bg-blue-600 rounded-xl font-black text-[10px] uppercase active:scale-95">🚗 Assign</button>
                <button onClick={() => setSelectedOrders(new Set())} className="px-3 py-1.5 bg-stone-700 rounded-xl font-black text-[10px] uppercase">Clear</button>
              </div>
            </div>
          )}
          {isAdmin && filteredOrders.length > 0 && (
            <button onClick={() => { if (selectedOrders.size === filteredOrders.length) setSelectedOrders(new Set()); else setSelectedOrders(new Set(filteredOrders.map(o => o.id))); }}
              className="text-[10px] font-black uppercase text-stone-400 mb-2 block">
              {selectedOrders.size === filteredOrders.length ? '✓ Deselect All' : `Select All (${filteredOrders.length})`}
            </button>
          )}
          {filteredOrders.map(o => renderOrderCard(o, true))}
          {filteredOrders.length === 0 && <div className="text-center py-12 text-stone-400"><Package size={32} className="mx-auto mb-2 opacity-50" /><p className="font-bold">No orders match filters</p></div>}
        </div>
      )}

      {/* ── FAILED VIEW ── */}
      {view === 'FAILED' && (
        <div className="px-4">
          <p className="font-black text-sm mb-3 text-red-600">Failed & Rescheduled Deliveries</p>
          {failedOrders.length === 0 ? (
            <div className="text-center py-12 text-stone-400"><CheckCircle2 size={32} className="mx-auto mb-2 opacity-50" /><p className="font-bold">No failed deliveries!</p></div>
          ) : failedOrders.map(o => (
            <div key={o.id} className="mb-2 bg-white border border-red-100 rounded-2xl overflow-hidden">
              <button onClick={() => setDetailOrder(o)} className="w-full px-4 py-3 text-left">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-black text-xs text-stone-400">{o.orderNumber}</span>
                  <BulkStatusBadge status={o.status} />
                </div>
                <p className="font-black text-base">{o.recipientName}</p>
                <p className="text-xs text-stone-500">{o.street}, {o.city} {o.zip}</p>
                {o.failureReason && <p className="text-xs text-red-500 font-bold mt-1">Reason: {FAILURE_REASON_LABELS[o.failureReason as keyof typeof FAILURE_REASON_LABELS] || o.failureReason}</p>}
                {isAdmin && (
                  <button onClick={(e) => { e.stopPropagation(); rescheduleOrder(o.id); }}
                    className="mt-2 px-3 py-1.5 bg-amber-500 text-white rounded-xl font-black text-[10px] uppercase active:scale-95">
                    ↻ Next Business Day
                  </button>
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── FEES VIEW ── */}
      {view === 'FEES' && isAdmin && (
        <div className="px-4">
          <p className="font-black text-sm mb-3">Delivery Fees Summary</p>
          <div className="flex gap-1.5 mb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <select value={feeFilter.driver || ''} onChange={e => setFeeFilter(f => ({ ...f, driver: e.target.value || undefined }))} className="bg-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase min-w-fit">
              <option value="">All Drivers</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={feeFilter.brand || ''} onChange={e => setFeeFilter(f => ({ ...f, brand: e.target.value || undefined }))} className="bg-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-black uppercase min-w-fit">
              <option value="">Both</option><option value="BERKOWITZ">Berkowitz</option><option value="PROVENANCE">Provenance</option>
            </select>
            <input type="date" value={feeFilter.dateFrom || ''} onChange={e => setFeeFilter(f => ({ ...f, dateFrom: e.target.value || undefined }))} className="bg-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-black min-w-fit" />
            <input type="date" value={feeFilter.dateTo || ''} onChange={e => setFeeFilter(f => ({ ...f, dateTo: e.target.value || undefined }))} className="bg-stone-100 rounded-lg px-2 py-1.5 text-[10px] font-black min-w-fit" />
          </div>
          <div className="bg-green-50 rounded-2xl p-4 mb-4 border border-green-100 text-center">
            <p className="text-[10px] font-black uppercase text-green-600">Total Fees Earned</p>
            <p className="font-black text-4xl text-green-700">${feeSummary.grandTotal}</p>
            <p className="text-xs text-green-600 font-bold">{feeSummary.deliveries.length} deliveries</p>
          </div>
          {Object.entries(feeSummary.byDriver).length > 0 && (
            <div className="bg-stone-50 rounded-2xl p-4 mb-3">
              <p className="font-black text-sm mb-2">By Driver</p>
              {Object.entries(feeSummary.byDriver).map(([name, data]: [string, any]) => (
                <div key={name} className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0">
                  <span className="font-bold text-sm">{name}</span>
                  <div className="text-right"><span className="font-black text-green-700">${data.total}</span><span className="text-xs text-stone-400 ml-2">({data.count})</span></div>
                </div>
              ))}
            </div>
          )}
          {Object.entries(feeSummary.byBrand).length > 0 && (
            <div className="bg-stone-50 rounded-2xl p-4">
              <p className="font-black text-sm mb-2">By Company</p>
              {Object.entries(feeSummary.byBrand).map(([brand, data]: [string, any]) => (
                <div key={brand} className="flex items-center justify-between py-2 border-b border-stone-100 last:border-0">
                  <span className="font-bold text-sm">{brand}</span>
                  <div className="text-right"><span className="font-black text-green-700">${data.total}</span><span className="text-xs text-stone-400 ml-2">({data.count})</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── MODALS ── */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowAssignModal(false)}>
          <div className="bg-white rounded-t-3xl w-full max-w-md p-4 pb-8" onClick={e => e.stopPropagation()}>
            <p className="font-black text-lg mb-4 text-center">Assign {selectedOrders.size} Orders to Driver</p>
            {drivers.map(d => (
              <button key={d.id} onClick={() => assignDriver(d.id, d.name)} className="w-full text-left px-4 py-3 mb-2 bg-stone-50 rounded-xl font-bold text-sm active:bg-stone-100">
                <Truck size={14} className="inline mr-2 text-stone-400" />{d.name}
              </button>
            ))}
            <button onClick={() => setShowAssignModal(false)} className="w-full py-3 text-stone-400 font-bold text-sm mt-2">Cancel</button>
          </div>
        </div>
      )}

      {showScheduleModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowScheduleModal(false)}>
          <div className="bg-white rounded-t-3xl w-full max-w-md p-4 pb-8" onClick={e => e.stopPropagation()}>
            <p className="font-black text-lg mb-4 text-center">Schedule {selectedOrders.size} Orders</p>
            <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)}
              className="w-full border border-stone-200 rounded-xl px-4 py-3 text-center font-black text-lg mb-4" />
            <button onClick={() => scheduleOrders(scheduleDate)} disabled={!scheduleDate}
              className={`w-full py-4 rounded-2xl font-black text-lg uppercase ${scheduleDate ? 'bg-black text-white active:scale-95' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}>
              Schedule for {scheduleDate ? new Date(scheduleDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '...'}
            </button>
            <button onClick={() => setShowScheduleModal(false)} className="w-full py-3 text-stone-400 font-bold text-sm mt-2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch { return null; }
  });
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [allUsers, setAllUsers] = useState<UserAccount[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Delivery | null>(null);
  const [isLoading, setIsLoading] = useState(true); // True until first data (cache or fetch)
  const [isSyncing, setIsSyncing] = useState(false); // True during background refresh
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'LIVE' | 'MOCK' | 'ERROR'>('MOCK');
  const [tab, setTab] = useState<'HOME' | 'ORDERS' | 'SCHEDULE' | 'ADMIN' | 'DRIVERS' | 'PROJECTS'>('SCHEDULE');
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'MANAGER';

  const [zipQuery, setZipQuery] = useState('');
  const [zipRate, setZipRate] = useState<number | null | undefined>(undefined);
  const [showZipBar, setShowZipBar] = useState(false);
  const [defaultDriver, setDefaultDriver] = useState<{ driverId: string | null; driverName: string | null }>({ driverId: null, driverName: null });
  // Global manual delivery state — accessible from any tab
  const [showGlobalAddManual, setShowGlobalAddManual] = useState(false);
  const [globalManualForm, setGlobalManualForm] = useState({ recipientName: '', recipientPhone: '', recipientEmail: '', street: '', unit: '', city: '', zip: '', deliveryFee: '', deliveryDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], deliveryInstructions: '', itemDescription: '', orderTotal: '', giftSenderName: '', giftMessage: '', driverId: '', driverName: '' });
  const [globalManualSaving, setGlobalManualSaving] = useState(false);
  const [globalManualError, setGlobalManualError] = useState('');
  const openAddManual = () => { setGlobalManualForm({ recipientName: '', recipientPhone: '', recipientEmail: '', street: '', unit: '', city: '', zip: '', deliveryFee: '', deliveryDate: new Date(Date.now() + 86400000).toISOString().split('T')[0], deliveryInstructions: '', itemDescription: '', orderTotal: '', giftSenderName: '', giftMessage: '', driverId: '', driverName: '' }); setGlobalManualError(''); setShowGlobalAddManual(true); };

  useEffect(() => {
    if (currentUser) {
      // INSTANT LOAD: Show cached orders if < 1 hour old
      try {
        const cached = localStorage.getItem('ordersCache');
        if (cached) {
          const { orders, timestamp } = JSON.parse(cached);
          const cacheAge = Date.now() - new Date(timestamp).getTime();
          const ONE_HOUR = 60 * 60 * 1000;
          // Only use cache if < 1 hour old AND has orders
          if (orders?.length > 0 && cacheAge < ONE_HOUR) {
            setDeliveries(orders);
            setIsLoading(false); // Show data instantly!
            const cacheTime = new Date(timestamp);
            setLastSync(cacheTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' (cached)');
          } else if (cacheAge >= ONE_HOUR) {
            // Cache too old - clear it
            localStorage.removeItem('ordersCache');
          }
        }
      } catch { /* cache miss or corrupt - no problem */ }
      
      // BACKGROUND REFRESH: Fetch fresh data behind the scenes
      fetchOrders(true); // true = background sync
      fetch('/api/users').then(r => r.json()).then(d => setAllUsers(d.users || []));
      fetch('/api/config/default-driver').then(r => r.json()).then(d => setDefaultDriver(d));
      const iv = setInterval(() => fetchOrders(true), 300000);
      
      // KEEP-ALIVE PING: Hit health endpoint every 4 minutes to prevent Render cold starts
      const pingInterval = setInterval(() => {
        fetch('/api/health').catch(() => {});
      }, 240000); // 4 minutes
      
      return () => { clearInterval(iv); clearInterval(pingInterval); };
    }
  }, [currentUser]);

  const fetchOrders = async (isBackgroundSync = false) => {
    // If we have cached data showing, use syncing indicator instead of full loading
    if (isBackgroundSync && deliveries.length > 0) {
      setIsSyncing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const fetched = await getDeliveries();
      const isMock = fetched.some((d: Delivery) => d.id === '33989');
      // Apply default driver to any order missing a driver
      const ddRaw = await fetch('/api/config/default-driver').then(r => r.json()).catch(() => null);
      // Fall back to Katie if nothing is configured yet
      const dd = ddRaw?.driverId ? ddRaw : { driverId: 'manager_1', driverName: 'Katie' };
      const withDriver = fetched.map((d: Delivery) => {
        if (!d.driverId || d.driverId === '') {
          return {
            ...d,
            driverId: dd.driverId,
            driverName: dd.driverName,
            // If status is still PENDING (meaning no tag has set it yet), bump to ASSIGNED
            status: d.status === DeliveryStatus.PENDING ? DeliveryStatus.ASSIGNED : d.status,
          };
        }
        // Order already has a driver — if still showing PENDING, correct it to ASSIGNED
        if (d.status === DeliveryStatus.PENDING) {
          return { ...d, status: DeliveryStatus.ASSIGNED };
        }
        return d;
      });
      setDeliveries(withDriver);
      if (dd) setDefaultDriver(dd);
      setDataSource(isMock ? 'MOCK' : 'LIVE');
      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      
      // CACHE: Save orders for instant load next time
      try {
        localStorage.setItem('ordersCache', JSON.stringify({
          orders: withDriver,
          timestamp: new Date().toISOString()
        }));
      } catch { /* localStorage full or disabled - no problem */ }
    } catch (err) {
      console.error('fetchOrders failed:', err);
      const { getDeliveries: gd } = await import('./services/shopifyService');
      try {
        const fallback = await gd();
        setDeliveries(fallback);
      } catch {}
      setDataSource('ERROR');
    }
    finally { 
      setIsLoading(false); 
      setIsSyncing(false);
    }
  };

  const handleUpdateOrder = useCallback((id: string, updates: Partial<Delivery>) => {
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    if (selectedOrder?.id === id) setSelectedOrder(prev => prev ? { ...prev, ...updates } : null);
  }, [selectedOrder]);

  const handleAddDelivery = useCallback((delivery: Delivery) => {
    setDeliveries(prev => [...prev, delivery]);
  }, []);

  // ── DRIVER ISOLATION: drivers only see orders assigned to them ──
  const visibleDeliveries = useMemo(() => {
    if (!currentUser) return deliveries;
    const admin = currentUser.role === 'SUPER_ADMIN' || currentUser.role === 'MANAGER';
    if (admin) return deliveries;
    return deliveries.filter(d => d.driverId === currentUser.id);
  }, [deliveries, currentUser]);

  const logout = () => {
    if (!window.confirm(`Log out as ${currentUser?.name}?`)) return;
    localStorage.removeItem('currentUser');
    localStorage.removeItem('ordersCache'); // Clear cached orders on logout
    // Force full page reload to clear ALL state and get fresh data
    window.location.reload();
  };

  if (!currentUser) {
    return <LoginGate onAuthorized={user => { setCurrentUser(user); localStorage.setItem('currentUser', JSON.stringify(user)); }} />;
  }

  if (selectedOrder) {
    return (
      <div className="max-w-md mx-auto min-h-screen bg-white">
        <OrderDetail
          order={selectedOrder}
          role={currentUser.role}
          currentUser={currentUser}
          allUsers={allUsers}
          onUpdate={handleUpdateOrder}
          onAddDelivery={handleAddDelivery}
          onBack={() => { setSelectedOrder(null); fetchOrders(); }}
        />
      </div>
    );
  }

  // Stats for orders tab header
  const todayStr = new Date().toISOString().split('T')[0];
  const OPEN_STATUSES_BADGE = [DeliveryStatus.PENDING, DeliveryStatus.SCHEDULED, DeliveryStatus.ASSIGNED, DeliveryStatus.IN_TRANSIT, DeliveryStatus.SECOND_ATTEMPT, DeliveryStatus.FAILED, DeliveryStatus.PENDING_RESCHEDULE];
  const activeOrders = visibleDeliveries.filter(d => OPEN_STATUSES_BADGE.includes(d.status));
  const pendingCount = visibleDeliveries.filter(d => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.ASSIGNED).length;
  const inTransitCount = visibleDeliveries.filter(d => d.status === DeliveryStatus.IN_TRANSIT).length;
  const deliveredTodayCount = visibleDeliveries.filter(d => d.status === DeliveryStatus.DELIVERED && (d.completedAt || '').startsWith(todayStr)).length;
  const isSameDayWindow = new Date().getHours() < 14;

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-[#e0e0e0] py-3 px-4 flex items-center justify-between shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <img src={BRAND_LOGO} alt="Sweet Tooth" className="h-9 w-auto object-contain" />
          <div>
            <p className="text-[9px] font-bold uppercase text-[#5F6368] leading-none">{currentUser.role.replace('_', ' ')}</p>
            <p className="text-sm font-bold text-[#202124] leading-tight">{currentUser.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Delivery Fee ZIP lookup — admin only */}
          {isAdmin && (
            <button onClick={() => { setShowZipBar(s => !s); setZipQuery(''); setZipRate(undefined); }}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg font-bold text-[10px] uppercase transition-all border whitespace-nowrap ${showZipBar ? 'bg-black text-white border-black' : 'bg-amber-400 text-black border-amber-500'}`}>
              <DollarSign size={11} /> ZIP Fee
            </button>
          )}
          <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : isSyncing ? 'bg-blue-400 animate-pulse' : dataSource === 'LIVE' ? 'bg-green-500' : 'bg-red-400'}`} />
          <button onClick={() => { localStorage.removeItem('ordersCache'); fetchOrders(false); }} className={`p-1.5 text-[#5F6368] ${isLoading || isSyncing ? 'animate-spin' : ''}`}><RefreshCw size={15} /></button>
          <button onClick={logout} className="flex items-center gap-1 px-3 py-2 bg-red-50 text-red-500 rounded-xl font-bold uppercase text-[10px] active:scale-95 border border-red-100">
            <LogOut size={13} /> Out
          </button>
        </div>
      </div>

      {/* Rate by ZIP dropdown bar */}
      {isAdmin && showZipBar && (
        <div className="sticky top-[60px] z-40 bg-white border-b border-stone-100 px-4 py-3 shadow-sm">
          <div className="flex gap-2 items-center">
            <input
              type="text" value={zipQuery} inputMode="numeric"
              onChange={e => { const v = e.target.value.replace(/\D/g,'').slice(0,5); setZipQuery(v); if (v.length === 5) setZipRate(DELIVERY_FEES[v] ?? null); else setZipRate(undefined); }}
              placeholder="Enter ZIP code..."
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-lg font-black text-center tracking-widest outline-none focus:border-black"
              autoFocus
            />
            <button onClick={() => setShowZipBar(false)} className="w-9 h-9 flex items-center justify-center bg-stone-100 rounded-xl text-stone-500 font-black"><X size={14} /></button>
          </div>
          {zipQuery.length === 5 && zipRate !== undefined && (
            zipRate !== null
              ? <div className="flex items-center justify-between mt-2 px-4 py-2.5 bg-green-50 border border-green-100 rounded-xl">
                  <span className="font-black text-stone-700 text-sm">ZIP {zipQuery}</span>
                  <span className="text-2xl font-black text-green-700">${zipRate}</span>
                </div>
              : <p className="mt-2 text-xs font-black text-red-500 text-center">ZIP {zipQuery} not in rate table</p>
          )}
        </div>
      )}

      {/* Global manual delivery modal */}
      {showGlobalAddManual && isAdmin && (
        <div className="fixed inset-0 z-[999] bg-black/60 flex items-end justify-center" onClick={() => setShowGlobalAddManual(false)}>
          <div className="bg-white w-full max-w-md rounded-t-3xl pb-10 flex flex-col" style={{ maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-stone-100 shrink-0">
              <p className="font-black text-base uppercase tracking-wide">➕ Add Delivery Manually</p>
              <button onClick={() => setShowGlobalAddManual(false)} className="w-8 h-8 flex items-center justify-center bg-stone-100 rounded-full"><X size={14} /></button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">

              {/* Recipient */}
              <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest">Recipient</p>
              <input value={globalManualForm.recipientName} onChange={e => setGlobalManualForm(f => ({ ...f, recipientName: e.target.value }))}
                placeholder="Recipient Name *" className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              <input value={globalManualForm.recipientPhone} onChange={e => setGlobalManualForm(f => ({ ...f, recipientPhone: e.target.value }))}
                placeholder="Recipient Phone" type="tel" className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />

              {/* Address */}
              <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest pt-1">Delivery Address</p>
              <input value={globalManualForm.street} onChange={e => setGlobalManualForm(f => ({ ...f, street: e.target.value }))}
                placeholder="Street Address *" className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              <input value={globalManualForm.unit} onChange={e => setGlobalManualForm(f => ({ ...f, unit: e.target.value }))}
                placeholder="Unit / Apt / Suite" className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              <div className="flex gap-2">
                <input value={globalManualForm.city} onChange={e => setGlobalManualForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="City *" className="flex-1 border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
                <input value={globalManualForm.zip}
                  onChange={e => {
                    const zip = e.target.value.replace(/\D/g,'').slice(0,5);
                    const autoFee = zip.length === 5 ? (DELIVERY_FEES[zip] ?? null) : null;
                    setGlobalManualForm(f => ({ ...f, zip, deliveryFee: autoFee !== null ? String(autoFee) : f.deliveryFee }));
                  }}
                  placeholder="ZIP *" maxLength={5} inputMode="numeric"
                  className="w-24 border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              </div>

              {/* Delivery Fee — auto-calculated from ZIP, editable */}
              <div className={`rounded-xl border-2 px-4 py-3 ${globalManualForm.deliveryFee ? 'border-green-400 bg-green-50' : 'border-stone-200'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest mb-1 ${globalManualForm.deliveryFee ? 'text-green-700' : 'text-stone-400'}">
                  💰 Delivery Fee {globalManualForm.zip.length === 5 && !DELIVERY_FEES[globalManualForm.zip] ? '(ZIP not in table — enter manually)' : globalManualForm.zip.length === 5 ? '(auto-calculated from ZIP)' : ''}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-black text-stone-400">$</span>
                  <input
                    value={globalManualForm.deliveryFee}
                    onChange={e => setGlobalManualForm(f => ({ ...f, deliveryFee: e.target.value }))}
                    placeholder="0"
                    type="number"
                    className="flex-1 bg-transparent text-2xl font-black outline-none text-green-700 placeholder-stone-300"
                  />
                </div>
              </div>

              {/* Delivery Details */}
              <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest pt-1">Delivery Details</p>
              <div>
                <p className="text-xs font-black text-stone-500 mb-1">Delivery Date *</p>
                <input type="date" value={globalManualForm.deliveryDate} onChange={e => setGlobalManualForm(f => ({ ...f, deliveryDate: e.target.value }))}
                  className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              </div>
              <textarea value={globalManualForm.deliveryInstructions} onChange={e => setGlobalManualForm(f => ({ ...f, deliveryInstructions: e.target.value }))}
                placeholder="⚠️ Delivery Instructions — gate code, call before, etc." rows={2}
                className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black resize-none" />

              {/* Order Info */}
              <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest pt-1">Order Info</p>
              <textarea value={globalManualForm.itemDescription} onChange={e => setGlobalManualForm(f => ({ ...f, itemDescription: e.target.value }))}
                placeholder="What's in the order? (e.g. Gift Basket — Large Oval, Dairy) *" rows={2}
                className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black resize-none" />
              <input value={globalManualForm.orderTotal} onChange={e => setGlobalManualForm(f => ({ ...f, orderTotal: e.target.value }))}
                placeholder="Order Total e.g. 850" type="number"
                className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />

              {/* Sender */}
              <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest pt-1">Gift Sender (optional)</p>
              <input value={globalManualForm.giftSenderName} onChange={e => setGlobalManualForm(f => ({ ...f, giftSenderName: e.target.value }))}
                placeholder="Sender Name" className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black" />
              <textarea value={globalManualForm.giftMessage} onChange={e => setGlobalManualForm(f => ({ ...f, giftMessage: e.target.value }))}
                placeholder="Gift Message" rows={2}
                className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-black resize-none" />

              {/* Driver */}
              <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest pt-1">Assign Driver *</p>
              <select value={globalManualForm.driverId}
                onChange={e => { const u = allUsers.find(u => u.id === e.target.value); setGlobalManualForm(f => ({ ...f, driverId: e.target.value, driverName: u?.name || '' })); }}
                className="w-full border-2 border-stone-200 rounded-xl px-4 py-3 text-sm font-black outline-none focus:border-black bg-white">
                <option value="">— Select Driver —</option>
                {allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>

              {globalManualError && <p className="text-sm font-black text-red-600 text-center bg-red-50 rounded-xl py-3">{globalManualError}</p>}
            </div>

            <div className="px-5 pt-3 shrink-0 border-t border-stone-100">
              <button disabled={globalManualSaving} onClick={async () => {
                setGlobalManualError('');
                if (!globalManualForm.recipientName.trim()) { setGlobalManualError('Recipient name is required.'); return; }
                if (!globalManualForm.street.trim()) { setGlobalManualError('Street address is required.'); return; }
                if (!globalManualForm.city.trim()) { setGlobalManualError('City is required.'); return; }
                if (!globalManualForm.zip.trim()) { setGlobalManualError('ZIP code is required.'); return; }
                if (!globalManualForm.itemDescription.trim()) { setGlobalManualError('Item description is required.'); return; }
                if (!globalManualForm.deliveryFee) { setGlobalManualError('Delivery fee is required.'); return; }
                setGlobalManualSaving(true);
                try {
                  const selectedDriver = allUsers.find(u => u.id === globalManualForm.driverId);
                  const finalDriverId = globalManualForm.driverId || 'manager_1';
                  const finalDriverName = selectedDriver?.name || globalManualForm.driverName || 'Katie';
                  console.log('Saving manual order with driver:', finalDriverId, finalDriverName);
                  const resp = await fetch('/api/manual-orders', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ...globalManualForm,
                      deliveryFee: globalManualForm.deliveryFee,
                      driverId: finalDriverId,
                      driverName: finalDriverName,
                    })
                  });
                  const data = await resp.json();
                  if (!data.success) throw new Error(data.error || 'Save failed');
                  // Refresh orders without reloading the page, stay on Deliveries tab
                  setShowGlobalAddManual(false);
                  setTab('SCHEDULE');
                  await fetchOrders();
                } catch (e: any) { setGlobalManualError(e.message || 'Something went wrong.'); setGlobalManualSaving(false); }
              }} className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${globalManualSaving ? 'bg-stone-300 text-stone-500' : 'bg-black text-white'}`}>
                {globalManualSaving ? 'Saving...' : '✓ Save Delivery'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BOTTOM NAV ── */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-stone-200 z-50 flex">

        {/* DELIVERIES */}
        <button onClick={() => setTab('SCHEDULE')}
          className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-all relative ${tab === 'SCHEDULE' ? 'text-black' : 'text-stone-300'}`}>
          <span className="relative">
            <span style={{ fontSize: 22 }}>🚚</span>
            {activeOrders.length > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1">
                {activeOrders.length > 99 ? '99+' : activeOrders.length}
              </span>
            )}
          </span>
          <span className="text-[9px] font-black uppercase">Deliveries</span>
        </button>

        {/* HISTORY */}
        <button onClick={() => setTab('ORDERS')}
          className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-all ${tab === 'ORDERS' ? 'text-black' : 'text-stone-300'}`}>
          <Clock size={22} />
          <span className="text-[9px] font-black uppercase">History</span>
        </button>

        {/* MANAGE — admin only */}
        {isAdmin && (
          <button onClick={() => setTab('ADMIN')}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-all ${tab === 'ADMIN' ? 'text-black' : 'text-stone-300'}`}>
            <Settings size={22} />
            <span className="text-[9px] font-black uppercase">Manage</span>
          </button>
        )}

      </div>

      <main className="flex-1 overflow-y-auto pb-20">

        {/* ── HOME TAB — dashboard for all users ── */}
        {tab === 'HOME' && (
          <ScheduleView
            deliveries={visibleDeliveries}
            role={currentUser.role}
            currentUserId={currentUser.id}
            allUsers={allUsers}
            onSelectOrder={setSelectedOrder}
            onUpdateOrder={handleUpdateOrder}
          />
        )}

        {/* ── DELIVERIES TAB ── */}
        {tab === 'SCHEDULE' && (
          <ScheduleView
            deliveries={visibleDeliveries}
            role={currentUser.role}
            currentUserId={currentUser.id}
            allUsers={allUsers}
            onSelectOrder={setSelectedOrder}
            onUpdateOrder={handleUpdateOrder}
          />
        )}

        {/* ── HISTORY TAB ── */}
        {tab === 'ORDERS' && (
          <OrdersView
            deliveries={visibleDeliveries}
            isAdmin={isAdmin}
            currentUser={currentUser}
            allUsers={allUsers}
            isSameDayWindow={isSameDayWindow}
            pendingCount={pendingCount}
            inTransitCount={inTransitCount}
            deliveredTodayCount={deliveredTodayCount}
            onSelectOrder={setSelectedOrder}
            onUpdateOrder={handleUpdateOrder}
          />
        )}

        {/* ── MANAGE TAB — admin only ── */}
        {tab === 'ADMIN' && isAdmin && (
          <div className="pb-24" style={{ background: '#F8F9FA' }}>
            {/* Stats Bar */}
            <div className="grid grid-cols-2" style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E7EB' }}>
              {[
                { label: 'Open', val: activeOrders.length, color: '#374151' },
                { label: 'Done Today', val: deliveredTodayCount, color: '#22C55E' },
              ].map(s => (
                <div key={s.label} className="py-3 text-center border-r border-stone-100 last:border-0">
                  <p className="text-2xl font-black" style={{ color: s.color }}>{s.val}</p>
                  <p className="text-[8px] font-black uppercase text-stone-400 leading-tight px-1">{s.label}</p>
                </div>
              ))}
            </div>
            {/* Add Delivery Button */}
            <div className="px-4 pt-4 pb-2" style={{ background: '#FFFFFF' }}>
              <button onClick={openAddManual}
                className="w-full py-4 bg-black text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                <Plus size={18} /> Add Delivery Manually
              </button>
            </div>
            {/* AdminPanel handles ALL admin features */}
            <AdminPanel role={currentUser.role} deliveries={deliveries} allUsers={allUsers} setAllUsers={setAllUsers} currentUser={currentUser} />
          </div>
        )}

      </main>
    </div>
  );
}
