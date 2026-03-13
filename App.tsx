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
  AlertTriangle, RotateCcw, Inbox
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
  { value: 'SCHEDULED',          label: 'Scheduled',          color: '#7c3aed' },
  { value: 'ASSIGNED',           label: 'Driver Assigned',    color: '#2563eb' },
  { value: 'IN_TRANSIT',         label: 'Out for Delivery',   color: '#000000' },
  { value: 'DELIVERED',          label: 'Delivered',          color: '#16a34a' },
  { value: 'FAILED',             label: '1st Attempt Failed', color: '#dc2626' },
  { value: 'SECOND_ATTEMPT',     label: '2nd Attempt',        color: '#374151' },
  { value: 'PENDING_RESCHEDULE', label: 'Needs Reschedule',   color: '#d97706' },
  { value: 'CLOSED',             label: 'Closed',             color: '#9ca3af' },
];
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Status badge config
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  PENDING:             { label: 'Not Assigned',       bg: 'bg-stone-800',   text: 'text-white' },
  SCHEDULED:           { label: 'Scheduled',          bg: 'bg-violet-600',  text: 'text-white' },
  ASSIGNED:            { label: 'Driver Assigned',    bg: 'bg-blue-600',    text: 'text-white' },
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
        <button onClick={() => { setRevealed(false); setShowTpl(false); }}
          className="px-3 py-2.5 bg-stone-200 text-stone-600 rounded-lg font-black uppercase text-xs active:bg-stone-300">
          Hide
        </button>
      </div>

      {/* SMS sent toast */}
      {smsSent && (
        <div className="flex items-center justify-center gap-2 bg-green-500 text-white rounded-xl px-3 py-2.5">
          <CheckCircle2 size={16} />
          <span className="text-sm font-black">Message copied — paste it in Messages!</span>
        </div>
      )}

      {showTpl && (
        <div className="space-y-1.5 pt-1">
          <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Choose a message to send:</p>
          {SMS_TEMPLATES_DATA.map(t => {
            const msgText = t.build(dn, dp, addr);
            return (
              <button
                key={t.id}
                onClick={() => {
                  // Copy to clipboard first, then open SMS blank so driver can paste
                  // This avoids iOS "repeatedly trying to open another application" block
                  navigator.clipboard?.writeText(msgText).catch(() => {});
                  window.location.href = `sms:${clean}`;
                  handleTemplateTap();
                }}
                className="flex items-center justify-between w-full bg-white border border-stone-200 rounded-lg px-3 py-2.5 active:bg-green-50 active:border-green-300 text-left">
                <span className="text-xs font-bold text-stone-800">{t.label}</span>
                <ChevronRight size={13} className="text-stone-400" />
              </button>
            );
          })}
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
            <button
              onClick={() => {
                if (!customMsg.trim()) return;
                navigator.clipboard?.writeText(customMsg).catch(() => {});
                window.location.href = `sms:${clean}`;
                handleTemplateTap();
              }}
              className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-black uppercase text-xs transition-all ${customMsg.trim() ? 'bg-green-500 text-white active:bg-green-600' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}>
              💬 Open Messages
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const SignaturePad: React.FC<{ onSave: (d: string) => void; onCancel: () => void }> = ({ onSave, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    const pos = (e: MouseEvent | TouchEvent) => {
      const r = canvas.getBoundingClientRect();
      const cx = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const cy = 'touches' in e ? e.touches[0].clientY : e.clientY;
      return { x: cx - r.left, y: cy - r.top };
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
      <p className="text-white/40 text-xs mb-4">Optional — skip if not available</p>
      <div className="flex-1 bg-white rounded-3xl overflow-hidden border-4 border-white">
        <canvas ref={canvasRef} width={400} height={600} className="w-full h-full touch-none" />
      </div>
      <div className="mt-4 flex gap-3">
        <button onClick={() => { const c = canvasRef.current; if (c) c.getContext('2d')?.clearRect(0,0,c.width,c.height); }} className="flex-1 py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px]">Clear</button>
        <button onClick={onCancel} className="flex-1 py-5 bg-white/20 text-white rounded-2xl font-black uppercase text-[10px]">Skip</button>
        <button onClick={() => canvasRef.current && onSave(canvasRef.current.toDataURL())} className="flex-2 py-5 bg-white text-black rounded-2xl font-black uppercase text-[10px] px-6">Confirm</button>
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

const OrderCard: React.FC<{ order: Delivery; role: AppRole; onTap: () => void; isSelected?: boolean }> = ({ order, role, onTap }) => {
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
            <p className="text-xs text-stone-400 leading-tight mt-0.5 truncate">{order.address?.street}, {order.address?.city} {order.address?.zip}</p>
            {product && <p className="text-[11px] text-stone-500 truncate mt-0.5">{product.name}{product.quantity > 1 ? ` ×${product.quantity}` : ''}</p>}
            {order.deliveryInstructions && (
              <div className="flex items-center gap-1 mt-1 bg-amber-100 rounded px-2 py-1">
                <AlertTriangle size={10} className="text-amber-700 shrink-0" />
                <p className="text-[10px] font-black text-amber-800 leading-tight truncate">{order.deliveryInstructions}</p>
              </div>
            )}
          </div>
          {/* Right: order# + status + price */}
          <div className="shrink-0 text-right flex flex-col items-end gap-1">
            <p className="text-[11px] font-black text-stone-500">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.text}`}>{statusCfg.label}</span>
            {product && <p className="text-sm font-black text-stone-900">${(product.price * product.quantity).toFixed(2)}</p>}
          </div>
        </div>
        {/* Driver row — admin only */}
        {(role === 'SUPER_ADMIN' || role === 'MANAGER') && (
          <p className="text-[10px] text-stone-400 mt-1">{order.driverName ? `Driver: ${order.driverName}` : ''}</p>
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

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const canSubmit = notes.trim().length > 0;

  // Step 1: just show the big red FAILED button — this component is shown after tap 1
  // so we start at step 2 (reason selection)
  return (
    <div className="fixed inset-0 bg-black/75 z-[200] flex items-end">
      <div className="w-full bg-white rounded-t-[40px] animate-in slide-in-from-bottom max-h-[90vh] overflow-y-auto">
        {/* Handle */}
        <div className="w-12 h-1 bg-stone-200 rounded-full mx-auto mt-4 mb-6" />

        {/* Step 2: Reason */}
        {step === 2 && (
          <div className="px-6 pb-8 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-black uppercase text-red-600">Why did it fail?</h3>
              <button onClick={onCancel}><X size={22} className="text-stone-400" /></button>
            </div>
            <p className="text-xs text-stone-500 font-medium">Order #{order.orderNumber?.replace(/^#+/, '') || order.id} — {order.giftReceiverName || order.customer.name}</p>
            <div className="space-y-2">
              {(Object.entries(FAILURE_REASON_LABELS) as [FailureReason, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setReason(key)}
                  className={`w-full py-5 px-5 rounded-[20px] font-black text-sm text-left flex items-center gap-3 transition-all active:scale-98 ${reason === key ? 'bg-red-500 text-white' : 'bg-stone-100 text-stone-700'}`}
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${reason === key ? 'border-white' : 'border-stone-300'}`}>
                    {reason === key && <div className="w-2.5 h-2.5 bg-white rounded-full" />}
                  </div>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setStep(3)} className="w-full py-6 bg-red-500 text-white rounded-[28px] font-black uppercase tracking-widest text-sm active:scale-95 transition-all">
              Next — Add Proof
            </button>
          </div>
        )}

        {/* Step 3: Notes + Photo + Submit */}
        {step === 3 && (
          <div className="px-6 pb-8 space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(2)} className="p-2 bg-stone-100 rounded-full"><ChevronLeft size={18} /></button>
              <div>
                <h3 className="text-lg font-black uppercase">Add Proof</h3>
                <p className="text-[10px] font-black text-stone-400 uppercase">{FAILURE_REASON_LABELS[reason]}</p>
              </div>
            </div>

            {/* Notes — mandatory */}
            <div>
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-widest block mb-2">
                Driver Notes <span className="text-red-500">*Required</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Gate code 1234 didn't work. Rang bell twice, no answer."
                className="w-full bg-stone-50 border-2 border-stone-200 rounded-[20px] px-5 py-4 text-sm font-medium outline-none focus:border-red-400 transition-all resize-none"
                style={{ minHeight: '100px' }}
              />
              {notes.trim().length === 0 && <p className="text-[10px] font-black text-red-400 mt-1">Notes are required before submitting</p>}
            </div>

            {/* Photo */}
            <input type="file" accept="image/*" capture="environment" ref={fileRef} onChange={handlePhoto} className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className={`w-full py-5 rounded-[24px] font-black uppercase text-sm flex items-center justify-center gap-3 active:scale-95 transition-all ${photo ? 'bg-green-50 text-green-700 border-2 border-green-200' : 'bg-stone-100 text-stone-700'}`}
            >
              <Camera size={20} />
              {photo ? '✓ Photo Taken — Retake' : 'Take Photo of Location'}
            </button>
            {photo && <img src={photo} className="w-full rounded-[18px] max-h-40 object-cover border border-stone-100" alt="Proof" />}

            {/* Submit */}
            <button
              onClick={() => canSubmit && onSubmit(reason, notes, photo)}
              disabled={!canSubmit}
              className="w-full py-7 bg-red-500 text-white rounded-[32px] font-black uppercase tracking-widest text-base flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-xl mt-2"
            >
              <XCircle size={24} /> SUBMIT FAILED DELIVERY
            </button>
          </div>
        )}

        {/* Show step indicator at bottom of step 2 */}
        {step === 2 && (
          <div className="flex justify-center gap-2 pb-6">
            <div className="w-8 h-1 bg-red-400 rounded-full" />
            <div className="w-8 h-1 bg-stone-200 rounded-full" />
          </div>
        )}
        {step === 3 && (
          <div className="flex justify-center gap-2 pb-2">
            <div className="w-8 h-1 bg-stone-200 rounded-full" />
            <div className="w-8 h-1 bg-red-400 rounded-full" />
          </div>
        )}
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
}> = ({ order, role, currentUser, allUsers, onUpdate, onAddDelivery, onBack }) => {
  const [isSigning, setIsSigning] = useState(false);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const isAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';
  const isCompleted = order.status === DeliveryStatus.DELIVERED || order.status === DeliveryStatus.FAILED || order.status === DeliveryStatus.PENDING_RESCHEDULE || order.status === DeliveryStatus.SECOND_ATTEMPT;

  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onloadend = () => setPhotoData(r.result as string); r.readAsDataURL(f);
  };

  const [showDeliveredConfirm, setShowDeliveredConfirm] = useState(false);

  const handleComplete = async () => {
    const now = new Date().toISOString();
    const updates: Partial<Delivery> = { status: DeliveryStatus.DELIVERED, confirmationPhoto: photoData || undefined, confirmationSignature: sigData || undefined, driverNotes: driverNote, completedAt: now, submittedAt: now };
    onUpdate(order.id, updates);
    await fetch('/api/pod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, photo: photoData, signature: sigData, notes: driverNote, completedAt: now, status: 'DELIVERED', driverId: currentUser.id, driverName: currentUser.name }) });
    // Show full-screen delivery confirmation, then go back
    setShowDeliveredConfirm(true);
    setTimeout(() => { setShowDeliveredConfirm(false); onBack(); }, 2500);
  };

  const handleFailSubmit = async (reason: FailureReason, notes: string, photo: string | null) => {
    const now = new Date().toISOString();
    const attempt = { id: Date.now().toString(), timestamp: now, driverId: currentUser.id, driverName: currentUser.name, attemptNumber: (order.attemptNumber || 1) as 1 | 2, reason, notes, photo: photo || undefined };
    onUpdate(order.id, { status: DeliveryStatus.FAILED, confirmationPhoto: photo || undefined, driverNotes: notes, submittedAt: now, attempts: [...(order.attempts || []), attempt] });
    await fetch('/api/pod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, photo, notes, submittedAt: now, status: 'FAILED', driverId: currentUser.id, driverName: currentUser.name, failureReason: reason }) });
    setPendingFailure({ reason, notes, photo });
    setShowFailFlow(false);
    setShowReschedule(true);
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
    setNotifyPreviewText(data.preview); setNotifyChannel(data.channel); setShowNotifyPreview(type); setNotifySent(false);
  };

  const handleSend = async () => {
    if (!showNotifyPreview) return;
    if (!isWithinSendingHours()) { alert('Messages can only be sent between 9 AM and 8 PM.'); return; }
    setIsSending(true);
    const res = await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: showNotifyPreview, order, failureReason: pendingFailure ? FAILURE_REASON_LABELS[pendingFailure.reason] : '', driverNotes: order.driverNotes || '' }) });
    const data = await res.json();
    setIsSending(false);
    if (data.sent) { setNotifySent(true); onUpdate(order.id, showNotifyPreview === 'SUCCESS' ? { successNotificationSent: true } : { failureNotificationSent: true }); }
    else alert(data.error || 'Failed to send. Check SendGrid setup (SENDGRID_API_KEY env var).');
  };

  const handleAddNote = async () => {
    if (!adminNote.trim()) return;
    await fetch(`/api/orders/${order.id}/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: adminNote }) });
    const ts = `[${new Date().toLocaleString()}] ${adminNote}`;
    onUpdate(order.id, { adminNotes: order.adminNotes ? `${order.adminNotes}\n${ts}` : ts });
    setAdminNote('');
  };

  const handleReassign = async () => {
    if (!reassignTo) return;
    const driver = allUsers.find(u => u.id === reassignTo); if (!driver) return;
    await fetch(`/api/orders/${order.id}/assign`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId: driver.id, driverName: driver.name }) });
    onUpdate(order.id, { driverId: driver.id, driverName: driver.name });
    setReassignTo('');
  };

  const [showGiftMsg, setShowGiftMsg] = useState(false);
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
    if (role === 'SUPER_ADMIN') {
      updates.deliveryFee = parseFloat(editFields.deliveryFee) || order.deliveryFee;
    }
    onUpdate(order.id, updates);
    await fetch(`/api/orders/${order.id}/edit`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    }).catch(() => {});
    setEditingContact(false);
  };

  const recipientPhone = editingContact ? editFields.recipientPhone : (order.customer?.phone || '');
  const senderPhone = editingContact ? editFields.senderPhone : (order.giftSenderPhone || '');
  const recipientName = editingContact ? editFields.recipientName : (order.giftReceiverName || order.customer?.name || '');
  const senderName = editingContact ? editFields.senderName : (order.giftSenderName || '');
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent([order.address?.street, order.address?.unit, order.address?.city, 'FL', order.address?.zip].filter(Boolean).join(' '))}`;
  const cleanOrderNum = order.orderNumber?.replace(/^#+/, '') || order.id;


  return (
    <div className="flex flex-col h-screen bg-gray-50">

      {/* ── DELIVERY CONFIRMED OVERLAY ── */}
      {showDeliveredConfirm && (
        <div className="fixed inset-0 z-[999] bg-green-500 flex flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center shadow-xl">
              <CheckCircle2 size={64} className="text-green-500" />
            </div>
            <p className="text-white text-3xl font-black uppercase tracking-widest">Delivered!</p>
            <p className="text-white/70 text-sm font-bold">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
          </div>
        </div>
      )}

      {/* ── HEADER: black bar, order#, status, back button ── */}
      <div className="bg-black text-white px-4 py-3 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center bg-white/10 rounded-full active:bg-white/20">
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xl font-black tracking-tight">#{cleanOrderNum}</p>
          <p className="text-xs text-white font-bold">{order.deliveryDate ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }) : 'Today'}</p>
        </div>
        {/* Status pill — green when delivered, white otherwise */}
        {!isAdmin && (
          <span className={`text-xs font-black px-3 py-1.5 rounded-full border ${order.status === DeliveryStatus.DELIVERED ? 'bg-green-500 border-green-400 text-white' : 'bg-white/10 border-white/20 text-white'}`}>
            {STATUS_CONFIG[order.status]?.label || order.status}
          </span>
        )}
        {/* Admin only: status change dropdown in header */}
        {isAdmin && (
          <select
            value={order.status}
            onChange={async e => {
              const s = e.target.value as DeliveryStatus;
              onUpdate(order.id, { status: s });
              fetch(`/api/orders/${order.id}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: s })
              }).catch(() => {});
            }}
            className="bg-white/10 text-white text-[11px] font-black border border-white/20 rounded-lg px-2 py-1.5 outline-none max-w-[130px]"
          >
            {STATUSES_FOR_DROPDOWN.map(s => (
              <option key={s.value} value={s.value} style={{ background: '#111', color: '#fff' }}>{s.label}</option>
            ))}
          </select>
        )}
      </div>

      {/* ── SCROLLABLE CONTENT ── */}
      <div className="flex-1 overflow-y-auto">

        {/* ── DELIVERY INSTRUCTIONS — only shows when present ── */}
        {order.deliveryInstructions && (
          <div className="mx-3 mt-3 bg-amber-400 rounded-xl px-4 py-4 flex gap-3 items-start">
            <AlertTriangle size={22} className="text-amber-900 shrink-0 mt-0.5" />
            <div>
              <p className="text-[9px] font-black uppercase text-amber-800 tracking-widest mb-1">Delivery Instructions</p>
              <p className="font-black text-amber-950 text-base leading-snug">{order.deliveryInstructions}</p>
            </div>
          </div>
        )}

        {/* ── MAIN DETAIL CARD — Lionwheel style ── */}
        <div className="mx-3 mt-3 bg-white rounded-xl border border-stone-200 overflow-hidden">

          {/* Recipient name + delivery badge */}
          <div className="px-4 pt-4 pb-3">
            <p className="text-2xl font-black text-stone-900 leading-tight">{recipientName}</p>
            <span className="inline-flex items-center gap-1 mt-1.5 px-3 py-1 rounded-full border border-stone-300 text-xs font-bold text-stone-600">
              🚚 Local Delivery
            </span>
          </div>

          {/* Info rows — Lionwheel table style */}
          <div className="border-t border-stone-100 divide-y divide-stone-100">

            {/* ADDRESS — large, prominent, fully clickable to open maps */}
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="block px-4 py-3 active:bg-stone-50">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-black uppercase text-stone-400 tracking-widest">Address</span>
                <span className="flex items-center gap-1 text-[10px] font-black text-blue-500 uppercase tracking-wide shrink-0 mt-0.5">
                  <Navigation size={11} /> Get Directions
                </span>
              </div>
              <p className="text-xl font-black text-stone-900 mt-1 leading-snug">{order.address.street}</p>
              {order.address.unit && (
                <span className="inline-flex items-center gap-1 mt-1 bg-amber-100 border border-amber-300 text-amber-900 text-sm font-black px-2.5 py-0.5 rounded-md">
                  🏢 {order.address.unit}
                </span>
              )}
              {order.address.company && (
                <p className="text-sm font-bold text-blue-700 mt-1">📍 {order.address.company}</p>
              )}
              <p className="text-base font-bold text-stone-600 mt-0.5">{order.address.city}, {order.address.zip}</p>
            </a>

            <div className="flex px-4 py-2.5"><span className="w-36 text-sm font-bold text-stone-900 shrink-0">Parcels:</span><span className="text-sm font-black text-stone-900">{order.items?.reduce((s,i) => s + i.quantity, 0) || 1}</span></div>

            <div className="flex px-4 py-2.5"><span className="w-36 text-sm font-bold text-stone-900 shrink-0">Gift Receiver:</span><span className="text-sm text-stone-700">{recipientName}</span></div>
            {order.orderTotal != null && <div className="flex px-4 py-2.5"><span className="w-36 text-sm font-bold text-stone-900 shrink-0">Order Total:</span><span className="text-sm font-black text-stone-900">${Number(order.orderTotal).toFixed(2)}</span></div>}
          </div>

          {/* Items table — larger, bold, grey background */}
          {order.items?.length > 0 && (
            <div className="border-t-2 border-stone-200">
              <div className="flex px-4 py-2.5 bg-stone-100">
                <span className="flex-1 text-xs font-black uppercase text-stone-500 tracking-widest">📦 Item Name</span>
                <span className="w-10 text-xs font-black uppercase text-stone-500 text-center">Qty</span>
                <span className="w-16 text-xs font-black uppercase text-stone-500 text-right">Price</span>
              </div>
              {order.items.map((item, i) => (
                <div key={i} className="flex items-start px-4 py-4 border-t border-stone-100 bg-stone-50">
                  <div className="flex-1 min-w-0 pr-2">
                    <p className="text-base font-black text-stone-900 leading-snug">{item.name}</p>
                    {item.sku && <p className="text-[11px] text-stone-400 italic mt-1">SKU: {item.sku}</p>}
                  </div>
                  <span className="w-10 text-base font-black text-stone-900 text-center">{item.quantity}</span>
                  <span className="w-16 text-base font-black text-stone-900 text-right">${item.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* ── CONTACT SECTION: Receiver first, Sender as backup ── */}
        <div className="mx-3 mt-3 bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-900">
            <span className="text-white text-xs font-black uppercase tracking-widest">💬 Need to reach someone?</span>
          </div>

          {/* Step 1: Gift Receiver */}
          <div className="px-4 py-3 border-b border-stone-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-black flex items-center justify-center shrink-0">1</span>
              <span className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Try Gift Receiver First</span>
            </div>
            <p className="text-base font-black text-stone-900 mb-2">{recipientName}</p>
            {recipientPhone ? (
              <ContactCallReveal
                phone={recipientPhone}
                label="Receiver"
                showTemplates={true}
                driverName={currentUser.name}
                driverPhone={currentUser.phone || ''}
                address={[order.address?.street, order.address?.unit].filter(Boolean).join(', ')}
              />
            ) : (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5">
                <span className="text-lg">⚠️</span>
                <div>
                  <p className="text-xs font-black text-amber-800 uppercase">No number provided</p>
                  <p className="text-[11px] text-amber-700 font-semibold">Contact the Gift Sender below ↓</p>
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Gift Sender backup */}
          {(senderName || senderPhone) && (
            <div className="px-4 py-3 bg-stone-50">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-5 h-5 rounded-full bg-stone-300 text-stone-600 text-[10px] font-black flex items-center justify-center shrink-0">2</span>
                <span className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Backup — Gift Sender</span>
              </div>
              <p className="text-base font-black text-stone-900 mb-2">{senderName}</p>
              {senderPhone ? (
                <ContactCallReveal
                  phone={senderPhone}
                  label="Gift Sender"
                  driverName={currentUser.name}
                  driverPhone={currentUser.phone || ''}
                />
              ) : (
                <p className="text-xs text-stone-400 italic">No phone number on file</p>
              )}
            </div>
          )}
        </div>

        {/* ── GIFT MESSAGE ── */}
        {order.giftMessage && (
          <button onClick={() => setShowGiftMsg(g => !g)}
            className="mx-3 mt-3 w-[calc(100%-1.5rem)] bg-white border border-stone-200 rounded-xl px-4 py-3 text-left active:bg-stone-50">
            <div className="flex justify-between items-center">
              <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest">Gift Message</p>
              <ChevronRight size={14} className={`text-stone-400 transition-transform ${showGiftMsg ? 'rotate-90' : ''}`} />
            </div>
            {showGiftMsg && <p className="text-sm text-stone-600 italic mt-2 leading-relaxed">"{order.giftMessage}"</p>}
          </button>
        )}

        {/* ── FAILED ATTEMPTS (if any) ── */}
        {order.attempts && order.attempts.length > 0 && (
          <div className="mx-3 mt-3 bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-4 py-2 bg-stone-50 border-b border-stone-100">
              <p className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Previous Attempts ({order.attempts.length})</p>
            </div>
            {order.attempts.map((a, i) => (
              <div key={i} className="px-4 py-3 border-b border-stone-100 last:border-0">
                <p className="font-black text-stone-800 text-sm">{FAILURE_REASON_LABELS[a.reason as FailureReason] || a.reason}</p>
                {a.notes && <p className="text-xs text-stone-500 italic mt-0.5">"{a.notes}"</p>}
                <p className="text-[10px] text-stone-400 mt-0.5">{a.driverName || 'Driver'} · {formatDate(a.timestamp)}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── ADMIN SECTION: assign driver + note (ONE place, not two) ── */}
        {isAdmin && (
          <div className="mx-3 mt-3 bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-4 py-2 bg-stone-50 border-b border-stone-100 flex items-center justify-between">
              <p className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Admin</p>
              <button onClick={() => setEditingContact(e => !e)}
                className={`text-[10px] font-black uppercase px-3 py-1 rounded-full transition-all ${editingContact ? 'bg-black text-white' : 'bg-stone-100 text-stone-600'}`}>
                <Edit3 size={10} className="inline mr-1" />{editingContact ? 'Editing' : 'Edit Info'}
              </button>
            </div>

            {/* Edit contact/address form */}
            {editingContact && (
              <div className="px-4 py-3 border-b border-stone-100 space-y-2">
                <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-2">Recipient</p>
                <input value={editFields.recipientName} onChange={e => setEditFields(p => ({ ...p, recipientName: e.target.value }))}
                  placeholder="Recipient name" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <input value={editFields.recipientPhone} onChange={e => setEditFields(p => ({ ...p, recipientPhone: e.target.value }))}
                  placeholder="Recipient phone" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <input value={editFields.recipientEmail} onChange={e => setEditFields(p => ({ ...p, recipientEmail: e.target.value }))}
                  placeholder="Recipient email" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2 mb-2">Sender</p>
                <input value={editFields.senderName} onChange={e => setEditFields(p => ({ ...p, senderName: e.target.value }))}
                  placeholder="Sender name" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <input value={editFields.senderPhone} onChange={e => setEditFields(p => ({ ...p, senderPhone: e.target.value }))}
                  placeholder="Sender phone" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2 mb-2">Address</p>
                <input value={editFields.street} onChange={e => setEditFields(p => ({ ...p, street: e.target.value }))}
                  placeholder="Street address" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={editFields.city} onChange={e => setEditFields(p => ({ ...p, city: e.target.value }))}
                    placeholder="City" className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                  <input value={editFields.zip} onChange={e => setEditFields(p => ({ ...p, zip: e.target.value.replace(/\D/g,'').slice(0,5) }))}
                    placeholder="ZIP" className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                </div>
                {/* Rate — SUPER_ADMIN only */}
                {role === 'SUPER_ADMIN' && (
                  <div>
                    <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2 mb-2">Delivery Rate (Super Admin only)</p>
                    <input value={editFields.deliveryFee} onChange={e => setEditFields(p => ({ ...p, deliveryFee: e.target.value }))}
                      placeholder="Rate ($)" inputMode="decimal" className="w-full bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-amber-400" />
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={handleSaveContact} className="flex-1 py-3 bg-black text-white rounded-xl font-black uppercase text-xs">Save Changes</button>
                  <button onClick={() => setEditingContact(false)} className="flex-1 py-3 bg-stone-100 text-stone-600 rounded-xl font-black uppercase text-xs">Cancel</button>
                </div>
              </div>
            )}

            {/* Driver assignment */}
            <div className="px-4 py-3 border-b border-stone-100">
              <p className="text-xs font-black text-stone-500 mb-2">
                Driver: <span className="text-stone-900">{order.driverName || 'Not assigned'}</span>
              </p>
              <div className="flex gap-2">
                <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
                  className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm font-bold outline-none">
                  <option value="">Change driver...</option>
                  {allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <button onClick={handleReassign} disabled={!reassignTo}
                  className="px-4 py-2 bg-black text-white rounded-lg font-black text-xs uppercase disabled:opacity-30">
                  Assign
                </button>
              </div>
            </div>
            {/* Note — one place only */}
            <div className="px-4 py-3">
              {order.adminNotes && (
                <div className="text-xs text-stone-600 mb-2 bg-stone-50 rounded-lg p-2 whitespace-pre-line">{order.adminNotes}</div>
              )}
              <div className="flex gap-2">
                <input value={adminNote} onChange={e => setAdminNote(e.target.value)}
                  placeholder="Add admin note..."
                  className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none" />
                <button onClick={handleAddNote}
                  className="px-4 py-2 bg-black text-white rounded-lg font-black text-xs uppercase">
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── PROOF OF DELIVERY + ACTIONS ── */}
        {!isCompleted && (
          <div className="mx-3 mt-3 mb-4 space-y-2">
            <input type="file" accept="image/*" capture="environment" ref={fileRef} onChange={handlePhoto} className="hidden" />
            {/* Note */}
            <textarea value={driverNote} onChange={e => setDriverNote(e.target.value)}
              placeholder="Add delivery note..."
              className="w-full bg-white border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none resize-none"
              style={{ minHeight: '72px' }} />
            {/* Photo + Sig row */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => fileRef.current?.click()}
                className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-black uppercase text-xs active:scale-95 ${photoData ? 'bg-green-600 text-white' : 'bg-stone-900 text-white'}`}>
                <Camera size={15} />{photoData ? '✓ Photo' : 'Add Photo'}
              </button>
              <button onClick={() => setIsSigning(true)}
                className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-black uppercase text-xs active:scale-95 ${sigData ? 'bg-green-600 text-white' : 'bg-stone-900 text-white'}`}>
                <PenTool size={15} />{sigData ? '✓ Signed' : 'Signature'}
              </button>
            </div>
            {photoData && <img src={photoData} className="w-full rounded-xl max-h-36 object-cover" alt="POD" />}
            {/* DELIVERED — requires photo */}
            <button
              onClick={photoData ? handleComplete : () => alert('Please add a delivery photo first.')}
              disabled={!photoData}
              className={'w-full py-5 rounded-2xl font-black uppercase text-xl tracking-wide flex items-center justify-center gap-2 shadow-lg transition-all ' + (photoData ? 'bg-green-600 text-white active:scale-95 cursor-pointer' : 'bg-stone-300 text-stone-400 cursor-not-allowed opacity-60')}>
              <CheckCircle2 size={24} /> DELIVERED
            </button>
            {!photoData && (
              <p className="text-center text-xs font-bold text-red-500 uppercase tracking-wide -mt-1">📷 Add a photo to enable delivery confirmation</p>
            )}
            {/* FAILED */}
            <button onClick={() => setShowFailFlow(true)}
              className="w-full py-4 border-2 border-stone-800 text-stone-900 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95">
              <XCircle size={18} /> FAILED DELIVERY
            </button>
          </div>
        )}

        {/* ── COMPLETED: show POD + notification button ── */}
        {isCompleted && (
          <div className="mx-3 mt-3 mb-4 space-y-2">
            <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
              <StatusBadge status={order.status} />
              {order.completedAt && (
                <p className="text-xs text-stone-500 mt-1">
                  {formatDate(order.completedAt)} at {formatTime(order.completedAt)}
                </p>
              )}
              {order.driverNotes && <p className="text-sm italic text-stone-600 mt-2">"{order.driverNotes}"</p>}
            </div>
            {order.confirmationPhoto && (
              <img src={order.confirmationPhoto} className="w-full rounded-xl max-h-36 object-cover" alt="Photo" />
            )}
            {order.confirmationSignature && (
              <div className="bg-white border border-stone-200 rounded-xl p-3">
                <p className="text-[9px] font-black uppercase text-stone-400 mb-1">Signature</p>
                <img src={order.confirmationSignature} className="w-full max-h-16 object-contain" alt="Sig" />
              </div>
            )}
            {/* Send notification */}
            {order.status === DeliveryStatus.DELIVERED && !order.successNotificationSent && (
              <button onClick={() => loadPreview('SUCCESS')}
                className="w-full py-3.5 bg-black text-white rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95">
                <Bell size={16} /> Send Delivery Confirmation
              </button>
            )}
            {order.status === DeliveryStatus.DELIVERED && order.successNotificationSent && (
              <p className="text-center text-xs font-black text-green-600 py-2">✓ Confirmation sent to customer</p>
            )}
            {(order.status === DeliveryStatus.FAILED || order.status === DeliveryStatus.PENDING_RESCHEDULE) && !order.failureNotificationSent && (
              <button onClick={() => loadPreview('FAILURE')}
                className="w-full py-3.5 bg-black text-white rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95">
                <Bell size={16} /> Send Reschedule Message
              </button>
            )}
            {(order.status === DeliveryStatus.FAILED || order.status === DeliveryStatus.PENDING_RESCHEDULE) && order.failureNotificationSent && (
              <p className="text-center text-xs font-black text-green-600 py-2">✓ Reschedule message sent</p>
            )}
          </div>
        )}

      </div>{/* end scroll */}

      {/* ── MODALS ── */}
      {showFailFlow && (
        <FailedDeliveryFlow order={order} currentUser={currentUser} onSubmit={handleFailSubmit} onCancel={() => setShowFailFlow(false)} />
      )}
      {showReschedule && pendingFailure && (
        <RescheduleModal order={order} failureReason={pendingFailure.reason} driverNotes={pendingFailure.notes} photo={pendingFailure.photo} onAutoReschedule={handleAutoReschedule} onManualReschedule={handleManualReschedule} />
      )}
      {showNotifyPreview && (
        <div className="fixed inset-0 bg-black/80 z-[200] flex items-end p-4">
          <div className="w-full bg-white rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-black uppercase text-sm">Preview Message</p>
              <button onClick={() => setShowNotifyPreview(null)}><X size={20} /></button>
            </div>
            <div className="bg-stone-50 rounded-xl p-3">
              <p className="text-sm text-stone-700 leading-relaxed">{notifyPreviewText}</p>
            </div>
            {notifySent
              ? <p className="text-center font-black text-green-600 py-2">✓ Sent!</p>
              : <button onClick={handleSend} disabled={isSending}
                  className="w-full py-4 bg-black text-white rounded-xl font-black uppercase text-base flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50">
                  {isSending ? <RefreshCw size={18} className="animate-spin" /> : <Send size={18} />} SEND
                </button>
            }
          </div>
        </div>
      )}
      {isSigning && (
        <SignaturePad onSave={(sig) => { setSigData(sig); setIsSigning(false); }} onCancel={() => setIsSigning(false)} />
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
  const [dateFilter, setDateFilter] = useState<'TODAY'|'ALL'>('TODAY');
  const [statusFilter, setStatusFilter] = useState<'ALL'|'OPEN'|'SCHEDULED'|'COMPLETED'>('ALL');

  const shiftDate = (days: number) => {
    const d = new Date(driverDate + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDriverDate(d.toISOString().split('T')[0]);
  };

  const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  // ── ADMIN VIEW ──
  if (isAdmin) {
    const sorted = [...deliveries].sort((a, b) => b.id.localeCompare(a.id)); // newest first
    const unassignedCount = deliveries.filter(d => !d.driverId || d.status === DeliveryStatus.PENDING).length;

    const adminToday = new Date().toISOString().split('T')[0];

    const COMPLETED_STATUSES = [DeliveryStatus.DELIVERED, DeliveryStatus.FAILED, DeliveryStatus.PENDING_RESCHEDULE, DeliveryStatus.SECOND_ATTEMPT, DeliveryStatus.CLOSED];
    const OPEN_STATUSES = [DeliveryStatus.PENDING, DeliveryStatus.SCHEDULED, DeliveryStatus.ASSIGNED, DeliveryStatus.IN_TRANSIT];

    const uniqueOrderDrivers = [
      { id: 'ALL', name: 'All Drivers' },
      ...allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => ({ id: u.id, name: u.name }))
    ];

    const todayFiltered = dateFilter === 'TODAY'
      ? sorted.filter(d => (d.deliveryDate || '').split('T')[0] === adminToday)
      : sorted;

    const filtered = todayFiltered.filter(d => {
      // Driver filter
      if (ordersDriverFilter !== 'ALL' && d.driverId !== ordersDriverFilter) return false;
      // Status filter
      if (statusFilter === 'OPEN' && !OPEN_STATUSES.includes(d.status)) return false;
      if (statusFilter === 'COMPLETED' && !COMPLETED_STATUSES.includes(d.status)) return false;
      // Text search
      if (!search) return true;
      const q = search.toLowerCase();
      const statusLabel = STATUSES_FOR_DROPDOWN.find(s => s.value === d.status)?.label?.toLowerCase() || '';
      return (
        d.orderNumber?.toLowerCase().includes(q) ||
        d.customer?.name?.toLowerCase().includes(q) ||
        d.address?.street?.toLowerCase().includes(q) ||
        d.address?.city?.toLowerCase().includes(q) ||
        d.giftReceiverName?.toLowerCase().includes(q) ||
        statusLabel.includes(q)
      );
    });

    return (
      <div className="flex flex-col h-full">
        {/* Stats */}
        <div className="grid grid-cols-4 border-b border-stone-200">
          {[
          { label: 'Assigned', val: deliveries.filter(d => d.driverId).length, color: 'text-blue-600' },
            { label: 'Assigned', val: deliveries.filter(d => d.status === DeliveryStatus.ASSIGNED).length, color: 'text-blue-600' },
            { label: 'Out for Delivery', val: inTransitCount, color: 'text-black' },
            { label: 'Done Today', val: deliveredTodayCount, color: 'text-green-600' },
          ].map(s => (
            <div key={s.label} className="py-3 text-center border-r border-stone-100 last:border-0">
              <p className={`text-xl font-black ${s.color}`}>{s.val}</p>
              <p className="text-[8px] font-black uppercase text-stone-400 leading-tight px-1">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Filters + Search */}
        <div className="px-3 pt-2 pb-2 border-b border-stone-200 space-y-2">
          {/* Driver filter dropdown */}
          <select value={ordersDriverFilter} onChange={e => setOrdersDriverFilter(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-black">
            {uniqueOrderDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {/* Date: Today / All */}
          <div className="flex gap-2">
            <button onClick={() => setDateFilter('TODAY')}
              className={`flex-1 py-2 rounded-xl font-black text-xs uppercase transition-all ${dateFilter === 'TODAY' ? 'bg-black text-white' : 'bg-stone-100 text-stone-500'}`}>
              Today ({sorted.filter(d => (d.deliveryDate||'').split('T')[0] === adminToday).length})
            </button>
            <button onClick={() => setDateFilter('ALL')}
              className={`flex-1 py-2 rounded-xl font-black text-xs uppercase transition-all ${dateFilter === 'ALL' ? 'bg-black text-white' : 'bg-stone-100 text-stone-500'}`}>
              All ({sorted.length})
            </button>
          </div>
          {/* Status: All / Open / Scheduled / Completed */}
          <div className="flex gap-1.5">
            {(['ALL','OPEN','SCHEDULED','COMPLETED'] as const).map(f => (
              <button key={f} onClick={() => setStatusFilter(f as any)}
                className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${(statusFilter as string) === f
                  ? (f === 'OPEN' ? 'bg-blue-600 text-white' : f === 'COMPLETED' ? 'bg-green-600 text-white' : f === 'SCHEDULED' ? 'bg-violet-600 text-white' : 'bg-stone-800 text-white')
                  : 'bg-stone-100 text-stone-500'}`}>
                {f === 'ALL' ? `All (${todayFiltered.length})`
                  : f === 'OPEN' ? `Open (${todayFiltered.filter(d => OPEN_STATUSES.includes(d.status)).length})`
                  : f === 'SCHEDULED' ? `Sched (${todayFiltered.filter(d => d.status === DeliveryStatus.SCHEDULED).length})`
                  : `Done (${todayFiltered.filter(d => COMPLETED_STATUSES.includes(d.status)).length})`}
              </button>
            ))}
          </div>
          {/* Text search */}
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, order #, address, status..."
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black"
          />
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[80px_1fr_90px_130px] bg-stone-50 border-b border-stone-200 px-3 py-2">
          <p className="text-[9px] font-black uppercase text-stone-600">Order # / Date</p>
          <p className="text-[9px] font-black uppercase text-stone-600">Customer</p>
          <p className="text-[9px] font-black uppercase text-stone-600">Driver</p>
          <p className="text-[9px] font-black uppercase text-stone-600 text-right">Status</p>
        </div>

        {/* Rows with day separators */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Package size={32} className="text-stone-200 mb-2" />
              <p className="text-xs font-black uppercase text-stone-300">No orders found</p>
            </div>
          ) : (() => {
            // Group orders by delivery date for day separators
            const rows: React.ReactNode[] = [];
            let lastDate = '';
            filtered.forEach((order, idx) => {
              const dateKey = (order.deliveryDate || '').split('T')[0];
              if (dateKey && dateKey !== lastDate) {
                lastDate = dateKey;
                const d = new Date(dateKey + 'T12:00:00');
                const dayLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
                const isToday = dateKey === adminToday;
                rows.push(
                  <div key={`sep-${dateKey}`} className={`flex items-center gap-3 px-3 py-2 sticky top-0 z-10 ${isToday ? 'bg-black' : 'bg-stone-700'}`}>
                    <span className={`text-xs font-black uppercase tracking-widest ${isToday ? 'text-white' : 'text-stone-200'}`}>
                      {isToday ? '📅 Today — ' : ''}{dayLabel}
                    </span>
                  </div>
                );
              }
              const statusCfg = STATUSES_FOR_DROPDOWN.find(s => s.value === order.status) || STATUSES_FOR_DROPDOWN[0];
              rows.push(
                <div key={order.id}
                  className={`grid grid-cols-[90px_1fr_90px_130px] px-3 py-3 border-b border-stone-100 transition-all ${idx % 2 === 0 ? 'bg-white' : 'bg-stone-50/40'}`}>
                  <div className="cursor-pointer" onClick={() => onSelectOrder(order)}>
                    <p className="text-sm font-black text-black">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
                    <p className="text-xs font-bold text-stone-700 mt-0.5">{order.deliveryDate ? fmtDate(order.deliveryDate) : '—'}</p>
                  </div>
                  <div className="pr-2 min-w-0 cursor-pointer" onClick={() => onSelectOrder(order)}>
                    <p className="text-sm font-bold text-stone-900 truncate">{order.giftReceiverName || order.customer?.name}</p>
                    <p className="text-[10px] text-stone-400 truncate">{order.address?.street}, {order.address?.city}</p>
                    {order.items?.[0] && (
                      <p className="text-[10px] font-black text-stone-600 truncate">{order.items[0].name} — ${order.items[0].price.toFixed(2)}</p>
                    )}
                    {order.deliveryInstructions && (
                      <div className="flex items-center gap-1 mt-0.5 bg-amber-100 rounded px-1.5 py-0.5">
                        <AlertTriangle size={9} className="text-amber-700 shrink-0" />
                        <p className="text-[9px] text-amber-800 font-black leading-tight">{order.deliveryInstructions}</p>
                      </div>
                    )}
                  </div>
                  <div className="cursor-pointer" onClick={() => onSelectOrder(order)}>
                    <p className="text-xs font-bold text-stone-700 truncate">{order.driverName || ''}</p>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <select
                      value={order.status}
                      onChange={e => {
                        const newStatus = e.target.value as DeliveryStatus;
                        onUpdateOrder(order.id, { status: newStatus });
                        fetch(`/api/orders/${order.id}/status`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: newStatus })
                        }).catch(() => {});
                      }}
                      style={{ backgroundColor: statusCfg.color, color: 'white' }}
                      className="w-full text-[10px] font-black rounded-lg px-2 py-1.5 outline-none border-0 appearance-none cursor-pointer"
                    >
                      {STATUSES_FOR_DROPDOWN.map(s => (
                        <option key={s.value} value={s.value} style={{ backgroundColor: s.color, color: 'white' }}>
                          {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              );
            });
            return rows;
          })()}
        </div>
      </div>
    );
  }

  // ── DRIVER VIEW ──
  const myOrders = deliveries.filter(d => {
    const dd = (d.deliveryDate || today).split('T')[0];
    return dd === driverDate && (d.driverId === currentUser.id || d.driverId === 'manager_1' && currentUser.role === 'MANAGER');
  });
  const active = myOrders.filter(d => d.status !== DeliveryStatus.DELIVERED && d.status !== DeliveryStatus.CLOSED);
  const done = myOrders.filter(d => d.status === DeliveryStatus.DELIVERED || d.status === DeliveryStatus.CLOSED);
  const shown = activeTab === 'active' ? active : done;

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
            <div key={order.id} onClick={() => onSelectOrder(order)}
              className="mx-3 mb-2 bg-white rounded-xl border border-stone-200 overflow-hidden active:scale-[0.99] transition-all cursor-pointer">
              {/* Status bar */}
              <div className={`${cardBg} px-3 py-1.5 flex items-center justify-between`}>
                <span className={`text-[10px] font-black uppercase tracking-widest ${isDelivered ? 'text-stone-500' : 'text-white'}`}>{labelText}</span>
                <span className={`text-xs font-black ${isDelivered ? 'text-stone-500' : 'text-white'}`}>#{order.orderNumber?.replace(/^#+/, '') || order.id}</span>
              </div>
              <div className="px-3 py-2.5 flex items-center gap-3">
                {/* Stop number */}
                <span className="text-2xl font-black text-stone-200 w-7 shrink-0 text-center">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  {/* RECIPIENT NAME — first and largest */}
                  <p className="text-base font-black text-stone-900 leading-tight">{order.giftReceiverName || order.customer?.name}</p>
                  <p className="text-sm text-stone-500 truncate">{order.address?.street}, {order.address?.city}</p>
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
                <ChevronRight size={16} className="text-stone-300 shrink-0" />
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

const ScheduleView: React.FC<{
  deliveries: Delivery[];
  role: AppRole;
  currentUserId: string;
  allUsers: UserAccount[];
  onSelectOrder: (order: Delivery) => void;
}> = ({ deliveries, role, currentUserId, allUsers, onSelectOrder }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('DAY');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [customStart, setCustomStart] = useState(new Date().toISOString().split('T')[0]);
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);
  const [filterDriver, setFilterDriver] = useState('ALL');
  const isAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';

  const getRange = (): [string, string] => {
    const d = new Date(selectedDate);
    if (viewMode === 'DAY') return [selectedDate, selectedDate];
    if (viewMode === 'WEEK') {
      const s = new Date(d); s.setDate(d.getDate() - d.getDay());
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return [s.toISOString().split('T')[0], e.toISOString().split('T')[0]];
    }
    if (viewMode === 'MONTH') {
      const s = new Date(d.getFullYear(), d.getMonth(), 1);
      const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return [s.toISOString().split('T')[0], e.toISOString().split('T')[0]];
    }
    return [customStart, customEnd];
  };

  const [rangeStart, rangeEnd] = getRange();

  const filtered = useMemo(() => deliveries.filter(d => {
    const date = (d.deliveryDate || new Date().toISOString()).split('T')[0];
    const inRange = date >= rangeStart && date <= rangeEnd;
    const myOrder = isAdmin ? true : (d.driverId === currentUserId || !d.driverId);
    const driverMatch = (isAdmin && filterDriver !== 'ALL') ? d.driverId === filterDriver : true;
    return inRange && myOrder && driverMatch;
  }), [deliveries, rangeStart, rangeEnd, currentUserId, isAdmin, filterDriver]);

  const grouped = useMemo(() => {
    const map: Record<string, Delivery[]> = {};
    filtered.forEach(d => {
      const date = (d.deliveryDate || new Date().toISOString()).split('T')[0];
      if (!map[date]) map[date] = [];
      map[date].push(d);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Use allUsers so ALL drivers show regardless of current assignments
  const uniqueDrivers = useMemo(() => {
    return allUsers
      .filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive)
      .map(u => ({ id: u.id, name: u.name }));
  }, [allUsers]);

  const shiftDay = (n: number) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + n);
    setSelectedDate(d.toISOString().split('T')[0]);
  };
  const todayStr = new Date().toISOString().split('T')[0];
  const fmtSelectedDate = (iso: string) => {
    const d = new Date(iso + 'T12:00:00');
    const isToday = iso === todayStr;
    const isTomorrow = iso === new Date(Date.now()+86400000).toISOString().split('T')[0];
    const isYesterday = iso === new Date(Date.now()-86400000).toISOString().split('T')[0];
    const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : isYesterday ? 'Yesterday' : '';
    return { day: d.toLocaleDateString('en-US',{weekday:'short'}), date: d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}), label };
  };
  const fmt = fmtSelectedDate(selectedDate);

  const [schedStatusFilter, setSchedStatusFilter] = useState<'ALL'|'OPEN'|'SCHEDULED'|'FAILED'|'2ND'|'CLOSED'>('ALL');

  const SCHED_OPEN = ['PENDING','ASSIGNED','IN_TRANSIT'] as string[];
  const SCHED_SCHEDULED = ['SCHEDULED'] as string[];
  const SCHED_FAILED = ['FAILED'] as string[];
  const SCHED_2ND = ['SECOND_ATTEMPT'] as string[];
  const SCHED_CLOSED = ['DELIVERED','FAILED','SECOND_ATTEMPT','PENDING_RESCHEDULE','CLOSED'] as string[];

  const filteredForStatus = useMemo(() => filtered.filter(d => {
    if (schedStatusFilter === 'OPEN') return SCHED_OPEN.includes(d.status);
    if (schedStatusFilter === 'SCHEDULED') return SCHED_SCHEDULED.includes(d.status);
    if (schedStatusFilter === 'FAILED') return SCHED_FAILED.includes(d.status);
    if (schedStatusFilter === '2ND') return SCHED_2ND.includes(d.status);
    if (schedStatusFilter === 'CLOSED') return SCHED_CLOSED.includes(d.status);
    return true;
  }), [filtered, schedStatusFilter]);

  const groupedForStatus = useMemo(() => {
    const map: Record<string, Delivery[]> = {};
    filteredForStatus.forEach(d => {
      const date = (d.deliveryDate || new Date().toISOString()).split('T')[0];
      if (!map[date]) map[date] = [];
      map[date].push(d);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [filteredForStatus]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="sticky top-0 bg-white z-10 border-b border-stone-200 px-4 pt-3 pb-3 space-y-3">
        {/* View mode tabs */}
        <div className="flex gap-1.5">
          {(['DAY', 'WEEK', 'MONTH', 'CUSTOM'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`flex-1 py-2 rounded-lg font-black uppercase text-[10px] transition-all ${viewMode === m ? 'bg-black text-white' : 'bg-stone-100 text-stone-500'}`}
            >{m}</button>
          ))}
        </div>
        {/* Date navigation */}
        {viewMode === 'DAY' ? (
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDay(-1)} className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center active:bg-stone-200 shrink-0">
              <ChevronLeft size={20} className="text-stone-700" />
            </button>
            <div className="flex-1 text-center">
              {fmt.label && <p className="text-[10px] font-black uppercase text-black tracking-widest">{fmt.label}</p>}
              <p className="text-base font-black text-stone-900">{fmt.day}, {fmt.date}</p>
            </div>
            <button onClick={() => shiftDay(1)} className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center active:bg-stone-200 shrink-0">
              <ChevronRight size={20} className="text-stone-700" />
            </button>
          </div>
        ) : viewMode === 'CUSTOM' ? (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
            <span className="text-stone-400 font-black">–</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3 py-2.5 text-sm font-bold outline-none" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDay(viewMode==='WEEK'?-7:-30)} className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center active:bg-stone-200 shrink-0">
              <ChevronLeft size={20} className="text-stone-700" />
            </button>
            <p className="flex-1 text-center text-base font-black text-stone-900">{fmt.day}, {fmt.date}</p>
            <button onClick={() => shiftDay(viewMode==='WEEK'?7:30)} className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center active:bg-stone-200 shrink-0">
              <ChevronRight size={20} className="text-stone-700" />
            </button>
          </div>
        )}
        {/* Driver filter (admin only) */}
        {isAdmin && uniqueDrivers.length > 0 && (
          <select value={filterDriver} onChange={e => setFilterDriver(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none">
            <option value="ALL">All Drivers</option>
            {uniqueDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {/* Status filter — row 1: All / Open / Scheduled / Closed */}
        <div className="flex gap-1.5">
          {(['ALL','OPEN','SCHEDULED','CLOSED'] as const).map(f => (
            <button key={f} onClick={() => setSchedStatusFilter(f)}
              className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${schedStatusFilter === f
                ? (f==='OPEN' ? 'bg-blue-600 text-white' : f==='SCHEDULED' ? 'bg-violet-600 text-white' : f==='CLOSED' ? 'bg-stone-500 text-white' : 'bg-stone-800 text-white')
                : 'bg-stone-100 text-stone-500'}`}>
              {f === 'ALL' ? `All (${filtered.length})`
                : f === 'OPEN' ? `Open (${filtered.filter(d => SCHED_OPEN.includes(d.status)).length})`
                : f === 'SCHEDULED' ? `Sched (${filtered.filter(d => SCHED_SCHEDULED.includes(d.status)).length})`
                : `Closed (${filtered.filter(d => SCHED_CLOSED.includes(d.status)).length})`}
            </button>
          ))}
        </div>
        {/* Status filter — row 2: Failed + 2nd Attempt pills */}
        <div className="flex gap-1.5">
          <button onClick={() => setSchedStatusFilter('FAILED')}
            className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${schedStatusFilter === 'FAILED' ? 'bg-red-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
            1st Failed ({filtered.filter(d => d.status === 'FAILED').length})
          </button>
          <button onClick={() => setSchedStatusFilter('2ND')}
            className={`flex-1 py-1.5 rounded-lg font-black text-[9px] uppercase transition-all ${schedStatusFilter === '2ND' ? 'bg-stone-700 text-white' : 'bg-stone-100 text-stone-500'}`}>
            2nd Attempt ({filtered.filter(d => d.status === 'SECOND_ATTEMPT').length})
          </button>
        </div>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[1fr_80px] px-4 py-1.5 bg-stone-100 border-b border-stone-200">
        <p className="text-[9px] font-black uppercase text-stone-500 tracking-widest">Order / Address</p>
        <p className="text-[9px] font-black uppercase text-stone-500 tracking-widest text-right">Status</p>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {groupedForStatus.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Calendar size={36} className="text-stone-200 mb-3" />
            <p className="text-[11px] font-black uppercase text-stone-300">No deliveries in this range</p>
          </div>
        ) : groupedForStatus.map(([date, orders]) => (
          <div key={date}>
            {/* Bold dark date header — easy to scan */}
            <div className="px-4 py-2.5 bg-stone-900 flex items-center justify-between sticky top-0 z-[5]">
              <p className="text-sm font-black text-white">
                {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
              <span className="text-[10px] font-black text-stone-400 bg-stone-800 px-2 py-0.5 rounded-full">{orders.length}</span>
            </div>
            {orders.map(order => <OrderCard key={order.id} order={order} role={role} onTap={() => onSelectOrder(order)} />)}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// PENDING RESCHEDULE QUEUE (Katie's Dashboard)
// ─────────────────────────────────────────────────────────────────────────────

const PendingRescheduleQueue: React.FC<{ allUsers: UserAccount[] }> = ({ allUsers }) => {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reschedule/pending').then(r => r.json()).then(d => { setQueue(d.queue || []); setLoading(false); });
  }, []);

  const updateEntry = async (id: string, updates: any) => {
    const res = await fetch(`/api/reschedule/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    const data = await res.json();
    setQueue(prev => prev.map(e => e.id === id ? data.entry : e));
  };

  const pending = queue.filter(e => e.status === 'PENDING');

  if (loading) return <div className="flex items-center justify-center py-24"><RefreshCw size={24} className="animate-spin text-stone-300" /></div>;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Inbox size={18} className="text-amber-500" />
        <h3 className="font-black uppercase text-stone-800">Pending Reschedule</h3>
        {pending.length > 0 && <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">{pending.length}</span>}
      </div>

      {pending.length === 0 && (
        <div className="text-center py-12">
          <Check size={32} className="mx-auto text-green-300 mb-2" />
          <p className="text-[11px] font-black uppercase text-stone-300">All clear — no pending reschedules</p>
        </div>
      )}

      {pending.map(entry => (
        <div key={entry.id} className="p-5 bg-white border border-amber-200 rounded-[28px] shadow-sm space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-black text-stone-900">{entry.customer?.name}</p>
              <p className="text-xs text-stone-500">{entry.address?.street}, {entry.address?.city}</p>
              <p className="text-xs text-stone-400">{entry.customer?.phone || entry.customer?.email}</p>
            </div>
            <span className="text-[9px] font-black uppercase bg-amber-100 text-amber-700 px-2 py-1 rounded-full">Pending</span>
          </div>
          <div className="p-3 bg-red-50 rounded-xl border border-red-100">
            <p className="text-[9px] font-black uppercase text-red-400 mb-1">Failure</p>
            <p className="text-xs font-black text-stone-800">{FAILURE_REASON_LABELS[entry.failureReason as FailureReason] || entry.failureReason}</p>
            {entry.driverNotes && <p className="text-xs text-stone-500 italic mt-1">"{entry.driverNotes}"</p>}
            <p className="text-[10px] text-stone-400 mt-1">Driver: {entry.driverName} • {entry.submittedAt ? formatDate(entry.submittedAt) : ''}</p>
          </div>
          {entry.photo && <img src={entry.photo} className="w-full rounded-xl max-h-32 object-cover border border-stone-100" alt="Proof" />}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => updateEntry(entry.id, { status: 'REASSIGNED' })}
              className="py-3 bg-black text-white rounded-2xl font-black uppercase text-[10px] active:scale-95">Reassign</button>
            <button onClick={() => { const addr = prompt('New address:'); if (addr) updateEntry(entry.id, { status: 'REASSIGNED', newAddress: addr }); }}
              className="py-3 bg-stone-100 text-stone-700 rounded-2xl font-black uppercase text-[10px] active:scale-95">Edit Addr</button>
            <button onClick={() => updateEntry(entry.id, { status: 'CANCELLED' })}
              className="py-3 bg-red-50 text-red-500 rounded-2xl font-black uppercase text-[10px] active:scale-95">Cancel</button>
          </div>
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DRIVER PAY CARD — collapsible per-delivery fees row
// ─────────────────────────────────────────────────────────────────────────────

const DriverPayCard: React.FC<{
  row: { id: string; name: string; count: number; total: number; stops: Delivery[] }
}> = ({ row }) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white border border-stone-100 rounded-[28px] shadow-sm overflow-hidden">
      {/* Summary row — always visible */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full p-5 flex items-center justify-between active:bg-stone-50 transition-all">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-stone-100 rounded-full flex items-center justify-center shrink-0">
            <User size={18} className="text-stone-500" />
          </div>
          <div className="text-left">
            <p className="font-black text-stone-900">{row.name}</p>
            <p className="text-[10px] font-black text-stone-400 uppercase">
              {row.count} {row.count === 1 ? 'delivery' : 'deliveries'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-2xl font-black text-stone-900">${row.total.toFixed(2)}</span>
          <ChevronRight size={16} className={`text-stone-300 transition-transform ${open ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {/* Drill-down — each delivery */}
      {open && (
        <div className="border-t border-stone-50">
          {row.stops.map((d, i) => (
            <div key={d.id}
              className={`flex items-center justify-between px-5 py-3.5 ${i % 2 === 0 ? 'bg-white' : 'bg-stone-50/50'}`}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black text-stone-800 truncate">
                  {d.giftReceiverName || d.customer.name}
                </p>
                <p className="text-[10px] text-stone-400 font-medium">
                  #{d.orderNumber} · {d.address.city} {d.address.zip}
                </p>
                {d.completedAt && (
                  <p className="text-[9px] font-black text-stone-300 uppercase mt-0.5">
                    {new Date(d.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {formatTime(d.completedAt)}
                  </p>
                )}
              </div>
              <span className="text-sm font-black text-green-700 ml-3 shrink-0">
                ${(d.deliveryFee || 0).toFixed(2)}
              </span>
            </div>
          ))}

          {/* Driver subtotal footer */}
          <div className="flex items-center justify-between px-5 py-4 bg-stone-900 rounded-b-[28px]">
            <span className="text-[10px] font-black uppercase text-white/60">
              Total owed to {row.name}
            </span>
            <span className="text-xl font-black text-white">${row.total.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES PANEL — templates + sent history
// ─────────────────────────────────────────────────────────────────────────────

const MessagesPanel: React.FC = () => {
  const [subTab, setSubTab] = useState<'HISTORY' | 'TEMPLATES'>('HISTORY');
  const [messages, setMessages] = useState<any[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateEdits, setTemplateEdits] = useState<Record<string, string>>({});
  const [configStatus, setConfigStatus] = useState<any>(null);
  const [testTo, setTestTo] = useState('');
  const [testChannel, setTestChannel] = useState<'SMS'|'Email'>('SMS');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    fetch('/api/messages').then(r => r.json()).then(d => { setMessages(d.messages || []); setLoadingMsgs(false); });
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates || []));
    fetch('/api/config/status').then(r => r.json()).then(d => setConfigStatus(d));
  }, []);

  const handleTestSend = async () => {
    if (!testTo) return;
    setTestLoading(true); setTestResult(null);
    const res = await fetch('/api/notify/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: testTo, channel: testChannel })
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

      {/* ── INTEGRATION STATUS BANNER ── */}
      {configStatus && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-black uppercase text-stone-500 tracking-widest mb-2">Notification Services</p>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-stone-700">SMS (Twilio)</span>
            <span className={`text-xs font-black px-3 py-1 rounded-full ${configStatus.twilio ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {configStatus.twilio ? `✓ Active (from ...${configStatus.twilioFrom})` : '✗ NOT CONFIGURED'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-stone-700">Email (SendGrid)</span>
            <span className={`text-xs font-black px-3 py-1 rounded-full ${configStatus.sendgrid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {configStatus.sendgrid ? `✓ Active` : '✗ NOT CONFIGURED'}
            </span>
          </div>
          {!configStatus.twilio && !configStatus.sendgrid && (
            <p className="text-xs text-red-600 font-bold mt-1">⚠ No notification service configured. Set TWILIO_* or SENDGRID_API_KEY env vars on Render.</p>
          )}
        </div>
      )}

      {/* ── TEST SEND ── */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <p className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Send Test Notification</p>
        <div className="flex gap-2">
          <button onClick={() => setTestChannel('SMS')}
            className={`flex-1 py-2 rounded-xl font-black text-xs uppercase ${testChannel==='SMS' ? 'bg-black text-white' : 'bg-stone-100 text-stone-500'}`}>SMS</button>
          <button onClick={() => setTestChannel('Email')}
            className={`flex-1 py-2 rounded-xl font-black text-xs uppercase ${testChannel==='Email' ? 'bg-black text-white' : 'bg-stone-100 text-stone-500'}`}>Email</button>
        </div>
        <input value={testTo} onChange={e => setTestTo(e.target.value)}
          placeholder={testChannel === 'SMS' ? 'Phone number (e.g. 3051234567)' : 'Email address'}
          className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-black" />
        <button onClick={handleTestSend} disabled={testLoading || !testTo}
          className="w-full py-3 bg-black text-white rounded-xl font-black uppercase text-sm disabled:opacity-40">
          {testLoading ? 'Sending...' : 'Send Test'}
        </button>
        {testResult && <p className="text-sm font-bold text-center">{testResult}</p>}
      </div>

      {/* Sub-tab toggle */}
      <div className="flex gap-2 bg-stone-100 rounded-2xl p-1">
        <button onClick={() => setSubTab('HISTORY')}
          className={`flex-1 py-3 rounded-xl font-black uppercase text-[10px] transition-all ${subTab === 'HISTORY' ? 'bg-white text-black shadow-sm' : 'text-stone-400'}`}>
          History
        </button>
        <button onClick={() => setSubTab('TEMPLATES')}
          className={`flex-1 py-3 rounded-xl font-black uppercase text-[10px] transition-all ${subTab === 'TEMPLATES' ? 'bg-white text-black shadow-sm' : 'text-stone-400'}`}>
          Templates
        </button>
      </div>

      {/* HISTORY */}
      {subTab === 'HISTORY' && (
        <div className="space-y-3">
          <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Most recent first • Max 500 stored</p>
          {loadingMsgs && (
            <div className="flex items-center justify-center py-12">
              <RefreshCw size={22} className="animate-spin text-stone-300" />
            </div>
          )}
          {!loadingMsgs && messages.length === 0 && (
            <div className="text-center py-12">
              <MessageCircle size={32} className="mx-auto text-stone-200 mb-2" />
              <p className="text-[11px] font-black uppercase text-stone-300">No messages sent yet</p>
            </div>
          )}
          {messages.map((msg: any) => (
            <div key={msg.id} className="bg-white border border-stone-100 rounded-[24px] shadow-sm overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-stone-50">
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full ${msg.type === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {msg.type === 'SUCCESS' ? 'Delivered' : 'Failed'}
                  </span>
                  <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full bg-stone-100 text-stone-500`}>
                    {msg.channel}
                  </span>
                </div>
                <span className="text-[9px] font-black text-stone-400">
                  {msg.sentAt ? new Date(msg.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
              {/* Details */}
              <div className="px-5 py-3 space-y-1">
                <p className="font-black text-stone-900 text-sm">{msg.customerName}</p>
                <p className="text-[10px] font-black text-stone-400 uppercase">Order #{msg.orderNumber} · Driver: {msg.driverName}</p>
                <p className="text-[10px] text-stone-400">{msg.channel === 'SMS' ? '📱' : '✉️'} {msg.to}</p>
              </div>
              {/* Message body — collapsible */}
              <details className="px-5 pb-4">
                <summary className="text-[10px] font-black uppercase text-stone-400 cursor-pointer select-none">View message</summary>
                <p className="mt-2 text-xs text-stone-600 leading-relaxed bg-stone-50 rounded-xl p-3 whitespace-pre-line">{msg.message}</p>
              </details>
            </div>
          ))}
        </div>
      )}

      {/* TEMPLATES */}
      {subTab === 'TEMPLATES' && (
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
      )}
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
    <div className="flex flex-col h-full bg-stone-50 overflow-y-auto pb-28">

      {/* Header */}
      <div className="bg-black text-white px-4 py-4">
        <p className="text-lg font-black">👥 Driver Management</p>
        <p className="text-xs text-white/50 mt-0.5">{drivers.length} driver{drivers.length !== 1 ? 's' : ''} · Name + phone required</p>
      </div>

      {/* Add new driver */}
      <div className="mx-4 mt-4 bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div className="px-4 py-3 bg-stone-900">
          <p className="text-xs font-black uppercase text-white tracking-widest">➕ Add New Driver</p>
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
            placeholder="Vehicle (optional)"
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
        <div className="px-4 py-3 bg-stone-900">
          <p className="text-xs font-black uppercase text-white tracking-widest">💬 Driver SMS Templates</p>
          <p className="text-[10px] text-white/50 mt-0.5">Auto-filled with driver name & number when sent</p>
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
        <div className="px-4 py-3 bg-stone-900">
          <p className="text-xs font-black uppercase text-white tracking-widest">🚗 Active Drivers</p>
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

const AdminPanel: React.FC<{ role: AppRole; deliveries: Delivery[]; allUsers: UserAccount[]; setAllUsers: React.Dispatch<React.SetStateAction<UserAccount[]>>; }> = ({ role, deliveries, allUsers, setAllUsers }) => {
  const [activeTab, setActiveTab] = useState<'DRIVERS' | 'RESCHEDULE' | 'MESSAGES' | 'FEES'>('DRIVERS');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [newDriver, setNewDriver] = useState({ name: '', pin: '', phone: '', vehicle: '' });
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [newPinVal, setNewPinVal] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [templateEdits, setTemplateEdits] = useState<Record<string, string>>({});
  const [feeZip, setFeeZip] = useState('');
  const [feeResult, setFeeResult] = useState<number | null>(null);
  const [feeStart, setFeeStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
  const [feeEnd, setFeeEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [feeCalculated, setFeeCalculated] = useState(false);
  const [calcStart, setCalcStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
  const [calcEnd, setCalcEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [feeDriverFilter, setFeeDriverFilter] = useState<string>('ALL');
  const [defaultDriverId, setDefaultDriverId] = useState<string>('');
  const [defaultDriverSaved, setDefaultDriverSaved] = useState(false);

  useEffect(() => {
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates || []));
    fetch('/api/config/default-driver').then(r => r.json()).then(d => { if (d.driverId) setDefaultDriverId(d.driverId); });
  }, []);

  const handleSaveDefaultDriver = async () => {
    const driver = allUsers.find(u => u.id === defaultDriverId);
    if (!driver) return;
    await fetch('/api/config/default-driver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driverId: driver.id, driverName: driver.name }) });
    setDefaultDriverSaved(true);
    setTimeout(() => setDefaultDriverSaved(false), 3000);
  };
  const drivers = allUsers.filter(u => u.role === 'DRIVER');

  const handleAddDriver = async () => {
    setAddError(''); setAddSuccess('');
    if (!newDriver.name || !newDriver.pin || !newDriver.phone) { setAddError('Name, PIN, and phone number are required'); return; }
    if (newDriver.pin.length !== 4) { setAddError('PIN must be 4 digits'); return; }
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newDriver, role: 'DRIVER' }) });
    const data = await res.json();
    if (!res.ok) { setAddError(data.error); return; }
    setAllUsers(prev => [...prev, data.user]);
    setNewDriver({ name: '', pin: '', phone: '', vehicle: '' });
    setAddSuccess(`${data.user.name} added!`);
    setTimeout(() => setAddSuccess(''), 3000);
  };

  const toggleActive = async (user: UserAccount) => {
    const res = await fetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !user.isActive }) });
    const data = await res.json();
    setAllUsers(prev => prev.map(u => u.id === user.id ? data.user : u));
  };

  const handleResetPin = async (userId: string) => {
    if (newPinVal.length !== 4) { alert('Must be 4 digits'); return; }
    await fetch(`/api/users/${userId}/reset-pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPin: newPinVal }) });
    setResetPinId(null); setNewPinVal('');
    alert('PIN reset!');
  };

  const handleSaveTemplate = async (id: string) => {
    const body = templateEdits[id]; if (!body) return;
    const res = await fetch(`/api/templates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
    const data = await res.json();
    setTemplates(prev => prev.map(t => t.id === id ? data.template : t));
    setEditingTemplate(null);
  };



  return (
    <div className="flex flex-col h-full bg-white">
      <div className="sticky top-0 bg-white z-10 border-b border-stone-100 px-4 pt-4 pb-0">
        <div className="flex gap-1 bg-stone-100 rounded-2xl p-1 overflow-x-auto">
          {(['DRIVERS', 'RESCHEDULE', 'MESSAGES', 'FEES'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 rounded-xl font-black uppercase text-[9px] whitespace-nowrap transition-all ${activeTab === tab ? 'bg-white text-black shadow-sm' : 'text-stone-400'}`}
            >{tab}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 pb-28">

        {activeTab === 'DRIVERS' && (
          <div className="space-y-5">

            {/* Default Driver Setting */}
            <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
              <div>
                <p className="font-black uppercase text-sm text-stone-800 flex items-center gap-2">⭐ Default Driver</p>
                <p className="text-xs text-stone-400 mt-0.5">All new incoming orders are automatically assigned to this driver</p>
              </div>
              {/* Current default — clearly shown */}
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white font-black text-sm shrink-0">
                  {(allUsers.find(u => u.id === defaultDriverId) || allUsers.find(u => u.id === 'manager_1'))?.name?.charAt(0) || '?'}
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-green-700 tracking-widest">Currently Assigned To</p>
                  <p className="text-sm font-black text-green-900">
                    {allUsers.find(u => u.id === defaultDriverId)?.name || 'Katie'}
                  </p>
                </div>
              </div>
              {/* Change default */}
              <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest">Change default driver:</p>
              <select
                value={defaultDriverId}
                onChange={e => setDefaultDriverId(e.target.value)}
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-black appearance-none"
              >
                <option value="">— Select a driver —</option>
                {allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              {defaultDriverSaved && <p className="text-xs font-black text-green-600">✅ Default driver saved!</p>}
              <button
                onClick={handleSaveDefaultDriver}
                disabled={!defaultDriverId}
                className={`w-full py-4 rounded-[24px] font-black uppercase tracking-widest text-sm transition-all ${defaultDriverId ? 'bg-black text-white active:scale-95' : 'bg-stone-200 text-stone-400 cursor-not-allowed'}`}
              >
                Save Default Driver
              </button>
            </div>

            {/* Add New Driver */}
            <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
              <p className="font-black uppercase text-sm text-stone-800 flex items-center gap-2"><UserPlus size={16} /> Add Driver</p>
              <input type="text" placeholder="Name" value={newDriver.name} onChange={e => setNewDriver(p => ({ ...p, name: e.target.value }))} className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black" />
              <input type="text" placeholder="4-digit PIN" maxLength={4} inputMode="numeric" value={newDriver.pin} onChange={e => setNewDriver(p => ({ ...p, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))} className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black" />
              <input type="tel" placeholder="Phone number *required*" value={newDriver.phone} onChange={e => setNewDriver(p => ({ ...p, phone: e.target.value }))} className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black" />
              <input type="text" placeholder="Vehicle (optional)" value={newDriver.vehicle} onChange={e => setNewDriver(p => ({ ...p, vehicle: e.target.value }))} className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black" />
              {addError && <p className="text-xs font-black text-red-500">{addError}</p>}
              {addSuccess && <p className="text-xs font-black text-green-600">{addSuccess}</p>}
              <button onClick={handleAddDriver} className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase tracking-widest active:scale-95 transition-all">Add Driver</button>
            </div>
            {drivers.map(u => (
              <div key={u.id} className={`p-5 bg-white border rounded-[28px] shadow-sm space-y-3 ${!u.isActive ? 'opacity-60' : 'border-stone-100'}`}>
                <div className="flex items-start justify-between">
                  <div><p className="font-black text-stone-900">{u.name}</p><p className="text-xs text-stone-400">{u.phone || 'No phone'} {u.vehicle ? `• ${u.vehicle}` : ''}</p></div>
                  <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>{u.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggleActive(u)} className={`flex-1 py-3 rounded-2xl font-black uppercase text-xs ${u.isActive ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>{u.isActive ? 'Deactivate' : 'Activate'}</button>
                  <button onClick={() => { setResetPinId(u.id); setNewPinVal(''); }} className="flex-1 py-3 bg-stone-100 text-stone-700 rounded-2xl font-black uppercase text-xs">Reset PIN</button>
                </div>
                {resetPinId === u.id && (
                  <div className="flex gap-2">
                    <input type="text" placeholder="New PIN" maxLength={4} inputMode="numeric" value={newPinVal} onChange={e => setNewPinVal(e.target.value.replace(/\D/g, '').slice(0, 4))} className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-black outline-none text-center tracking-widest" />
                    <button onClick={() => handleResetPin(u.id)} className="px-4 py-3 bg-black text-white rounded-xl font-black text-xs uppercase">Save</button>
                    <button onClick={() => setResetPinId(null)} className="px-4 py-3 bg-stone-100 text-stone-500 rounded-xl font-black text-xs uppercase">×</button>
                  </div>
                )}
              </div>
            ))}
            {drivers.length === 0 && <div className="text-center py-12"><Users size={32} className="mx-auto text-stone-200 mb-2" /><p className="text-[11px] font-black uppercase text-stone-300">No drivers yet</p></div>}
          </div>
        )}

        {activeTab === 'RESCHEDULE' && <PendingRescheduleQueue allUsers={allUsers} />}

        {activeTab === 'MESSAGES' && <MessagesPanel />}

        {false && activeTab === 'TEMPLATES_REMOVED' && (
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
                    <textarea value={templateEdits[t.id] ?? t.body} onChange={e => setTemplateEdits(p => ({ ...p, [t.id]: e.target.value }))} rows={6} className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black resize-none" style={{ minHeight: '120px' }} />
                    <div className="flex gap-2">
                      <button onClick={() => handleSaveTemplate(t.id)} className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs">Save</button>
                      <button onClick={() => setEditingTemplate(null)} className="flex-1 py-3 bg-stone-100 text-stone-500 rounded-2xl font-black uppercase text-xs">Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-stone-600 leading-relaxed bg-stone-50 rounded-xl p-3 whitespace-pre-line">{t.body}</p>
                    <button onClick={() => { setEditingTemplate(t.id); setTemplateEdits(p => ({ ...p, [t.id]: t.body })); }} className="w-full py-3 bg-stone-100 text-stone-700 rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2"><Edit3 size={14} /> Edit Template</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'FEES' && (() => {
          // ── compute per-delivery fees ──────────────────────────────────
          // Use completedAt first, fall back to deliveryDate (completedAt lost on server restart)
          const inRange = feeCalculated ? deliveries.filter(d => {
            if (d.status !== DeliveryStatus.DELIVERED) return false;
            const dateToCheck = (d.completedAt || d.submittedAt || d.deliveryDate || '').split('T')[0];
            if (!dateToCheck) return true; // include if no date info — show all delivered
            return dateToCheck >= calcStart && dateToCheck <= calcEnd;
          }) : [];

          // group by driver
          const byDriver: Record<string, { name: string; stops: Delivery[] }> = {};
          inRange.forEach(d => {
            const key = d.driverId || 'unassigned';
            const name = d.driverName || 'Unassigned';
            if (!byDriver[key]) byDriver[key] = { name, stops: [] };
            byDriver[key].stops.push(d);
          });

          const driverRows = Object.entries(byDriver).map(([id, { name, stops }]) => ({
            id, name,
            count: stops.length,
            total: stops.reduce((s, d) => s + (d.deliveryFee || 0), 0),
            stops
          })).sort((a, b) => b.total - a.total);


          const filteredRows = feeDriverFilter === 'ALL' ? driverRows : driverRows.filter(r => r.id === feeDriverFilter);
          const grandTotal = filteredRows.reduce((s, r) => s + r.total, 0);
          const grandCount = filteredRows.reduce((s, r) => s + r.count, 0);

          return (
            <div className="space-y-4">

              {/* Date range + driver filter */}
              <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-4">
                <p className="font-black uppercase text-sm text-stone-800 flex items-center gap-2">
                  <FileText size={16} /> Delivery Fees
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">From</label>
                    <input type="date" value={feeStart} onChange={e => { setFeeStart(e.target.value); setFeeCalculated(false); }}
                      className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2.5 text-xs font-black outline-none focus:border-black" />
                  </div>
                  <div>
                    <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">To</label>
                    <input type="date" value={feeEnd} onChange={e => { setFeeEnd(e.target.value); setFeeCalculated(false); }}
                      className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2.5 text-xs font-black outline-none focus:border-black" />
                  </div>
                </div>

                {/* Driver filter */}
                <div>
                  <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">Driver</label>
                  <select
                    value={feeDriverFilter}
                    onChange={e => { setFeeDriverFilter(e.target.value); setFeeCalculated(false); }}
                    className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-black appearance-none"
                  >
                    <option value="ALL">All Drivers</option>
                    {allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>

                <button onClick={() => { setCalcStart(feeStart); setCalcEnd(feeEnd); setFeeCalculated(true); }}
                  className="w-full py-4 bg-black text-white rounded-2xl font-black uppercase tracking-widest text-sm active:scale-95 transition-all">
                  Calculate Fees
                </button>

                {/* Grand total banner */}
                {feeCalculated && (
                  <div className="flex items-center justify-between p-4 bg-black rounded-2xl">
                    <div>
                      <p className="text-[9px] font-black uppercase text-white/50 mb-0.5">
                        {feeDriverFilter === 'ALL' ? 'Grand Total — All Drivers' : `Total — ${allUsers.find(u => u.id === feeDriverFilter)?.name || 'Driver'}`}
                      </p>
                      <p className="text-[10px] font-black text-white/60">{grandCount} successful {grandCount === 1 ? 'delivery' : 'deliveries'}</p>
                      <p className="text-[9px] text-white/40">{calcStart} → {calcEnd}</p>
                    </div>
                    <span className="text-3xl font-black text-white">${grandTotal.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Per-driver cards */}
              {feeCalculated && (filteredRows.length === 0 ? (
                <div className="text-center py-12">
                  <FileText size={32} className="mx-auto text-stone-200 mb-2" />
                  <p className="text-[11px] font-black uppercase text-stone-300">No completed deliveries in this range</p>
                </div>
              ) : filteredRows.map(row => (
                <DriverPayCard key={row.id} row={row} />
              )))}

            </div>
          );
        })()}
      </div>
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
  const [isLoading, setIsLoading] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'LIVE' | 'MOCK' | 'ERROR'>('MOCK');
  const [tab, setTab] = useState<'ORDERS' | 'SCHEDULE' | 'ADMIN' | 'DRIVERS'>('SCHEDULE');
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'MANAGER';
  const [zipQuery, setZipQuery] = useState('');
  const [zipRate, setZipRate] = useState<number | null | undefined>(undefined);
  const [showZipBar, setShowZipBar] = useState(false);
  const [defaultDriver, setDefaultDriver] = useState<{ driverId: string | null; driverName: string | null }>({ driverId: null, driverName: null });

  useEffect(() => {
    if (currentUser) {
      fetchOrders();
      fetch('/api/users').then(r => r.json()).then(d => setAllUsers(d.users || []));
      fetch('/api/config/default-driver').then(r => r.json()).then(d => setDefaultDriver(d));
      const iv = setInterval(fetchOrders, 300000);
      return () => clearInterval(iv);
    }
  }, [currentUser]);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const fetched = await getDeliveries();
      const isMock = fetched.some((d: Delivery) => d.id === '33989');
      // Apply default driver to any order missing a driver
      const ddRaw = await fetch('/api/config/default-driver').then(r => r.json()).catch(() => null);
      // Fall back to Katie if nothing is configured yet
      const dd = ddRaw?.driverId ? ddRaw : { driverId: 'manager_1', driverName: 'Katie' };
      const withDriver = fetched.map((d: Delivery) =>
        (!d.driverId || d.driverId === '') ? { ...d, driverId: dd.driverId, driverName: dd.driverName } : d
      );
      setDeliveries(withDriver);
      if (dd) setDefaultDriver(dd);
      setDataSource(isMock ? 'MOCK' : 'LIVE');
      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('fetchOrders failed:', err);
      const { getDeliveries: gd } = await import('./services/shopifyService');
      try {
        const fallback = await gd();
        setDeliveries(fallback);
      } catch {}
      setDataSource('ERROR');
    }
    finally { setIsLoading(false); }
  };

  const handleUpdateOrder = useCallback((id: string, updates: Partial<Delivery>) => {
    setDeliveries(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
    if (selectedOrder?.id === id) setSelectedOrder(prev => prev ? { ...prev, ...updates } : null);
  }, [selectedOrder]);

  const handleAddDelivery = useCallback((delivery: Delivery) => {
    setDeliveries(prev => [...prev, delivery]);
  }, []);

  const logout = () => {
    if (!window.confirm(`Log out as ${currentUser?.name}?`)) return;
    localStorage.removeItem('currentUser');
    setCurrentUser(null); setDeliveries([]); setSelectedOrder(null);
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
          onBack={() => setSelectedOrder(null)}
        />
      </div>
    );
  }

  // Stats for orders tab header
  const todayStr = new Date().toISOString().split('T')[0];
  const activeOrders = deliveries.filter(d =>
    d.status !== DeliveryStatus.DELIVERED &&
    d.status !== DeliveryStatus.CLOSED
  );
  const pendingCount = deliveries.filter(d => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.ASSIGNED).length;
  const inTransitCount = deliveries.filter(d => d.status === DeliveryStatus.IN_TRANSIT).length;
  const deliveredTodayCount = deliveries.filter(d => d.status === DeliveryStatus.DELIVERED && (d.completedAt || '').startsWith(todayStr)).length;
  const isSameDayWindow = new Date().getHours() < 14;

  return (
    <div className="max-w-md mx-auto min-h-screen bg-white flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-stone-100 py-3 px-4 flex items-center justify-between shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <img src={BRAND_LOGO} alt="Sweet Tooth" className="h-9 w-auto object-contain" />
          <div>
            <p className="text-[8px] font-black uppercase text-stone-400 leading-none">{currentUser.role.replace('_', ' ')}</p>
            <p className="text-sm font-black text-stone-900 leading-tight">{currentUser.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Rate by ZIP pill — admin only */}
          {isAdmin && (
            <button onClick={() => { setShowZipBar(s => !s); setZipQuery(''); setZipRate(undefined); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-black text-[10px] uppercase transition-all border ${showZipBar ? 'bg-black text-white border-black' : 'bg-stone-50 text-stone-700 border-stone-200'}`}>
              <MapPin size={11} /> Delivery Fee
            </button>
          )}
          <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : dataSource === 'LIVE' ? 'bg-green-500' : 'bg-red-400'}`} />
          <button onClick={fetchOrders} className={`p-1.5 text-stone-400 ${isLoading ? 'animate-spin' : ''}`}><RefreshCw size={15} /></button>
          <button onClick={logout} className="flex items-center gap-1 px-3 py-2 bg-red-50 text-red-500 rounded-xl font-black uppercase text-[10px] active:scale-95 border border-red-100">
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

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-stone-100 z-50 flex">
        <button onClick={() => setTab('ORDERS')}
          className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-all ${tab === 'ORDERS' ? 'text-black' : 'text-stone-300'}`}>
          <Package size={20} />
          <span className="text-[9px] font-black uppercase">Orders</span>
          {activeOrders.length > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-black text-white text-[8px] font-black rounded-full flex items-center justify-center">{activeOrders.length > 99 ? '99+' : activeOrders.length}</span>}
        </button>
        <button onClick={() => setTab('SCHEDULE')}
          className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-all ${tab === 'SCHEDULE' ? 'text-black' : 'text-stone-300'}`}>
          <Calendar size={20} />
          <span className="text-[9px] font-black uppercase">Schedule</span>
        </button>
        {isAdmin && (
          <button onClick={() => setTab('DRIVERS')}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-all ${tab === 'DRIVERS' ? 'text-black' : 'text-stone-300'}`}>
            <Users size={20} />
            <span className="text-[9px] font-black uppercase">Drivers</span>
          </button>
        )}
        {isAdmin && (
          <button onClick={() => setTab('ADMIN')}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-all ${tab === 'ADMIN' ? 'text-black' : 'text-stone-300'}`}>
            <Settings size={20} />
            <span className="text-[9px] font-black uppercase">Admin</span>
          </button>
        )}
      </div>

      <main className="flex-1 overflow-y-auto pb-20">

        {/* ── ORDERS TAB ── */}
        {tab === 'ORDERS' && (
          <OrdersView
            deliveries={deliveries}
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

        {/* ── SCHEDULE TAB ── */}
        {tab === 'SCHEDULE' && (
          <ScheduleView
            deliveries={deliveries}
            role={currentUser.role}
            currentUserId={currentUser.id}
            allUsers={allUsers}
            onSelectOrder={setSelectedOrder}
          />
        )}

        {/* ── DRIVERS TAB ── */}
        {tab === 'DRIVERS' && isAdmin && (
          <DriversView allUsers={allUsers} setAllUsers={setAllUsers} currentUser={currentUser} />
        )}

        {/* ── ADMIN TAB ── */}
        {tab === 'ADMIN' && isAdmin && (
          <AdminPanel role={currentUser.role} deliveries={deliveries} allUsers={allUsers} setAllUsers={setAllUsers} />
        )}

      </main>
    </div>
  );
}
