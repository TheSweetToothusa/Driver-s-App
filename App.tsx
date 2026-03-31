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
  AlertTriangle, RotateCcw, Inbox, Home, DollarSign, Store, Truck, Map as MapIcon, Route, Trash2, Plus
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
  { value: 'ASSIGNED',           label: 'Assigned',           color: '#2563eb' },
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
        {/* Driver row — admin: shows driver name + inline reassign dropdown */}
        {isAdmin && (
          <div className="mt-1.5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            <select
              value={reassignTo || order.driverId || ''}
              onChange={async e => {
                const u = allUsers?.find(u => u.id === e.target.value);
                if (!u) return;
                setReassignTo(e.target.value);
                const isManualOrder = (order as any).isManual;
                await fetch(isManualOrder ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/assign`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ driverId: u.id, driverName: u.name })
                });
                if (onUpdate) onUpdate(order.id, { driverId: u.id, driverName: u.name });
                setReassignTo('');
              }}
              className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-xs font-bold outline-none text-stone-700"
            >
              <option value="">👤 {order.driverName || 'Assign driver...'}</option>
              {allUsers?.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
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
            <input type="file" accept="image/*" capture="environment" ref={fileRef} onChange={handlePhoto} className="hidden" />
            <div>
              <label className="text-[10px] font-black uppercase text-stone-500 tracking-widest block mb-2">
                📷 Photo of Property <span className="text-red-500">*Required</span>
              </label>
              <button onClick={() => fileRef.current?.click()}
                className={`w-full py-5 rounded-[24px] font-black uppercase text-sm flex items-center justify-center gap-3 active:scale-95 transition-all ${photo ? 'bg-green-50 text-green-700 border-2 border-green-400' : 'bg-red-50 text-red-700 border-2 border-red-300'}`}
              >
                <Camera size={20} />
                {photo ? '✓ Photo Taken — Retake' : 'TAKE PHOTO NOW (Required)'}
              </button>
              {!photo && <p className="text-[10px] font-black text-red-500 mt-1 text-center">You must take a photo before submitting</p>}
              {photo && <img src={photo} className="w-full rounded-[18px] max-h-40 object-cover border border-stone-100 mt-2" alt="Proof" />}
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
    const r = new FileReader(); r.onloadend = () => { setPhotoData(r.result as string); setPhotoTimestamp(new Date().toISOString()); }; r.readAsDataURL(f);
  };

  const [showDeliveredConfirm, setShowDeliveredConfirm] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showNavChoice, setShowNavChoice] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pendingDate, setPendingDate] = useState(order.deliveryDate || '');
  const [dateSavedToast, setDateSavedToast] = useState(false);
  const [navAddress, setNavAddress] = useState('');

  const handleComplete = async () => {
    const now = new Date().toISOString();
    const updates: Partial<Delivery> = { status: DeliveryStatus.DELIVERED, confirmationPhoto: photoData || undefined, confirmationSignature: sigData || undefined, driverNotes: driverNote, completedAt: now, submittedAt: now };
    onUpdate(order.id, updates);
    await fetch('/api/pod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, photo: photoData, signature: sigData, notes: driverNote, completedAt: now, status: 'DELIVERED', driverId: currentUser.id, driverName: currentUser.name }) });
    // Show full-screen delivery confirmation, then go back
    setShowDeliveredConfirm(true);
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
    const isManualOrder = (order as any).isManual;
    await fetch(isManualOrder ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId: driver.id, driverName: driver.name })
    });
    onUpdate(order.id, { driverId: driver.id, driverName: driver.name });
    setReassignTo('');
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
  const cleanOrderNum = order.orderNumber?.replace(/^#+/, '') || order.id;

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
              onUpdate(order.id, { deliveryDate: pendingDate });
              await fetch(`/api/orders/${order.id}/edit`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliveryDate: pendingDate }) });
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
          {isAdmin ? (
            <button onClick={() => { setPendingDate(order.deliveryDate || ''); setShowDatePicker(true); }} className="flex items-center gap-1.5 active:opacity-70">
              <span className="text-xs text-amber-300 font-bold">
                {order.deliveryDate ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }) : 'Today'}
              </span>
              <span className="text-[10px] bg-white/20 rounded px-1 py-0.5 text-white/80 font-bold">Change</span>
            </button>
          ) : (
            <p className="text-xs text-white font-bold">{order.deliveryDate ? new Date(order.deliveryDate + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }) : 'Today'}</p>
          )}
        </div>
        {!isAdmin && (
          <span className={`text-xs font-black px-3 py-1.5 rounded-full border ${order.status === DeliveryStatus.DELIVERED ? 'bg-green-500 border-green-400 text-white' : 'bg-white/10 border-white/20 text-white'}`}>
            {STATUS_CONFIG[order.status]?.label || order.status}
          </span>
        )}
        {isAdmin && (
          <select
            value={order.status}
            onChange={async e => {
              const s = e.target.value as DeliveryStatus;
              onUpdate(order.id, { status: s });
              const isManualOrd = (order as any).isManual;
              fetch(isManualOrd ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/status`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s })
              }).catch(() => {});
            }}
            className="bg-white/10 text-white text-[11px] font-black border border-white/20 rounded-lg px-2 py-1.5 outline-none max-w-[130px]"
          >
            {STATUSES_FOR_DROPDOWN.map(s => (
              <option key={s.value} value={s.value} style={{ background: '#111', color: '#fff' }}>{s.label}</option>
            ))}
          </select>
        )}
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
      </div>

      {/* ── SCROLLABLE CONTENT ── */}
      <div className="flex-1 overflow-y-auto pb-6">

        {/* ── DELIVERY INSTRUCTIONS — amber banner when present ── */}
        {order.deliveryInstructions && (
          <div className="mx-3 mt-3 bg-amber-400 rounded-xl px-4 py-4 flex gap-3 items-start">
            <AlertTriangle size={22} className="text-amber-900 shrink-0 mt-0.5" />
            <div>
              <p className="text-[9px] font-black uppercase text-amber-800 tracking-widest mb-1">Delivery Instructions</p>
              <p className="font-black text-amber-950 text-base leading-snug">{order.deliveryInstructions}</p>
            </div>
          </div>
        )}

        {/* ── ZONE 1: ORDER INFO CARD ── */}
        <div className="mx-3 mt-3 bg-white rounded-xl border border-stone-200 overflow-hidden">
          {/* Recipient name */}
          <div className="px-4 pt-4 pb-3">
            <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest mb-1">Delivering To</p>
            <p className="text-3xl font-black text-stone-900 leading-tight">{recipientName}</p>
          </div>

          <div className="border-t border-stone-100 divide-y divide-stone-100">
            {/* Address — tappable to choose nav app */}
            <button onClick={() => openNavChoice([order.address?.street, order.address?.unit, order.address?.city, 'FL', order.address?.zip].filter(Boolean).join(' '))} className="block w-full text-left px-4 py-3 active:bg-stone-50">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10px] font-black uppercase text-stone-400 tracking-widest">Address</span>
                <span className="flex items-center gap-1 text-[10px] font-black text-blue-500 uppercase tracking-wide shrink-0 mt-0.5">
                  <Navigation size={11} /> Get Directions
                </span>
              </div>
              <p className="text-xl font-black text-stone-900 mt-1 leading-snug">{order.address.street}{order.address.unit ? ` #${order.address.unit}` : ''}</p>
              {order.address.company && <p className="text-sm font-bold text-blue-700 mt-1">📍 {order.address.company}</p>}
              <p className="text-2xl font-black text-black mt-1">{order.address.city}, {order.address.zip}</p>
            </button>

            {/* Items with SKU — parcels count */}
            {order.items?.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase text-stone-400 tracking-widest">Items</span>
                  <span className="text-[10px] font-black uppercase text-stone-400 tracking-widest">
                    {order.items.reduce((sum, it) => sum + (it.quantity || 1), 0)} Parcel{order.items.reduce((sum, it) => sum + (it.quantity || 1), 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                {order.items.map((item, i) => (
                  <div key={i} className="py-2 border-b border-stone-50 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-black text-stone-900 flex-1 leading-snug">{item.name}</p>
                      <span className="text-sm font-black text-stone-500 shrink-0">×{item.quantity}</span>
                    </div>
                    {item.variantTitle && (
                      <p className="text-xs font-bold text-stone-600 mt-0.5">{item.variantTitle}</p>
                    )}
                    {item.properties && item.properties.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        {item.properties.filter((prop: any) => {
                          const n = prop.name?.toLowerCase() || '';
                          return !n.includes('delivery fee') && !n.includes('_') && prop.value && prop.value !== 'null';
                        }).map((prop: any, pi: number) => (
                          <div key={pi} className="flex items-baseline gap-1.5">
                            <span className="text-[10px] font-black uppercase text-stone-400 tracking-wide shrink-0">{prop.name}:</span>
                            <span className="text-xs font-bold text-stone-700">{prop.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Gift Sender */}
            {(order.giftSenderName || order.giftSenderPhone) && (
              <div className="px-4 py-3">
                <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest mb-1">Gift From</p>
                <p className="text-base font-black text-stone-900">{order.giftSenderName || '—'}</p>
                {order.giftSenderPhone && (
                  <p className="text-sm font-bold text-stone-500 mt-0.5">{order.giftSenderPhone}</p>
                )}
              </div>
            )}

            {/* Gift Message */}
            {order.giftMessage && (
              <div className="px-4 py-3 bg-pink-50">
                <p className="text-[10px] font-black uppercase text-pink-400 tracking-widest mb-1">🎁 Gift Message</p>
                <p className="text-sm font-bold text-stone-800 leading-snug italic">"{order.giftMessage}"</p>
              </div>
            )}

            {/* Order Total + Created At */}
            <div className="px-4 py-3 flex items-center justify-between">
              {order.orderTotal != null && (
                <div>
                  <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest mb-0.5">Order Total</p>
                  <p className="text-base font-black text-stone-900">${order.orderTotal.toFixed(2)}</p>
                </div>
              )}
              {order.createdAt && (
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase text-stone-400 tracking-widest mb-0.5">Order Date</p>
                  <p className="text-sm font-black text-stone-700">
                    {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── ZONE 2: CONTACT — collapsed by default ── */}
        {!isCompleted && (
          <div className="mx-3 mt-3">
            <button
              onClick={() => setShowContactSection(s => !s)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-stone-200 active:bg-stone-50"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">📞</span>
                <span className="text-sm font-black text-stone-700">Need to call someone?</span>
              </div>
              <ChevronRight size={16} className={`text-stone-400 transition-transform ${showContactSection ? 'rotate-90' : ''}`} />
            </button>

            {showContactSection && (
              <div className="bg-white rounded-b-xl border border-t-0 border-stone-200 overflow-hidden">
                {/* Try Recipient First */}
                <div className="px-4 py-3 border-b border-stone-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-5 h-5 rounded-full bg-green-500 text-white text-[10px] font-black flex items-center justify-center shrink-0">1</span>
                    <span className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Try Recipient First</span>
                  </div>
                  <p className="text-base font-black text-stone-900 mb-2">{recipientName}</p>
                  {recipientPhone ? (
                    <ContactCallReveal phone={recipientPhone} label="Receiver" showTemplates={true} driverName={currentUser.name} driverPhone={currentUser.phone || ''} address={[order.address?.street, order.address?.unit].filter(Boolean).join(', ')} />
                  ) : (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5">
                      <span className="text-lg">⚠️</span>
                      <p className="text-xs font-black text-amber-800">No number — try Gift Sender below</p>
                    </div>
                  )}
                </div>

                {/* Sender Backup */}
                {(senderName || senderPhone) && (
                  <div className="px-4 py-3 bg-stone-50">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-5 h-5 rounded-full bg-stone-300 text-stone-600 text-[10px] font-black flex items-center justify-center shrink-0">2</span>
                      <span className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Backup — Gift Sender</span>
                    </div>
                    <p className="text-base font-black text-stone-900 mb-2">{senderName}</p>
                    {senderPhone ? (
                      <ContactCallReveal phone={senderPhone} label="Gift Sender" driverName={currentUser.name} driverPhone={currentUser.phone || ''} />
                    ) : (
                      <p className="text-xs text-stone-400 italic">No phone number on file</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── ZONE 3: PROOF OF DELIVERY (main action zone) ── */}
        {!isCompleted && (
          <div className="mx-3 mt-4 bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-4 py-3 bg-stone-900">
              <p className="text-white font-black uppercase text-xs tracking-widest">📋 Proof of Delivery</p>
              <p className="text-stone-400 text-[10px] font-bold mt-0.5">Required for all deliveries — successful or not</p>
            </div>

            <input type="file" accept="image/*" capture="environment" ref={fileRef} onChange={handlePhoto} className="hidden" />

            <div className="p-4 space-y-3">
              {/* PHOTO — primary, full width */}
              <button
                onClick={() => fileRef.current?.click()}
                className={`w-full py-5 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-3 active:scale-95 transition-all ${photoData ? 'bg-green-600 text-white' : 'bg-stone-900 text-white'}`}
              >
                <Camera size={20} />
                {photoData ? '✓ Photo Taken — Tap to Retake' : '📷 TAKE PHOTO'}
              </button>

              {/* Photo preview + timestamp */}
              {photoData && (
                <div className="rounded-xl overflow-hidden border border-stone-200">
                  <img src={photoData} className="w-full max-h-48 object-cover" alt="POD" />
                  {photoTimestamp && (
                    <div className="bg-stone-900 px-3 py-1.5 flex items-center gap-2">
                      <span className="text-green-400 text-[10px]">●</span>
                      <p className="text-white text-[11px] font-black">
                        {new Date(photoTimestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(photoTimestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* SIGNATURE — secondary, shown after photo */}
              <button
                onClick={() => setIsSigning(true)}
                className={`w-full py-4 rounded-xl font-black uppercase text-sm flex items-center justify-center gap-3 active:scale-95 transition-all ${sigData ? 'bg-green-600 text-white' : 'bg-stone-100 text-stone-700 border border-stone-200'}`}
              >
                <PenTool size={18} />
                {sigData ? '✓ Signature Captured' : 'Add Recipient Signature'}
              </button>

              {/* Signature preview */}
              {sigData && (
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-3">
                  <p className="text-[9px] font-black uppercase text-stone-400 mb-2">Captured Signature</p>
                  <img src={sigData} className="w-full max-h-20 object-contain" alt="Signature" />
                </div>
              )}

              {/* Driver note */}
              <textarea
                value={driverNote}
                onChange={e => setDriverNote(e.target.value)}
                placeholder="Driver note (e.g. left at front door, unit 4B)"
                className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none resize-none"
                style={{ minHeight: '64px' }}
              />
            </div>

            {/* ACTION BUTTONS */}
            <div className="px-4 pb-4 space-y-2">
              {/* CONFIRM DELIVERY */}
              <button
                onClick={photoData ? handleComplete : () => alert('Please take a delivery photo first.')}
                disabled={!photoData}
                className={'w-full py-5 rounded-2xl font-black uppercase text-xl tracking-wide flex items-center justify-center gap-2 shadow-lg transition-all ' + (photoData ? 'bg-green-600 text-white active:scale-95' : 'bg-stone-200 text-stone-400 cursor-not-allowed')}
              >
                <CheckCircle2 size={24} /> CONFIRM DELIVERY
              </button>
              {!photoData && (
                <p className="text-center text-[11px] font-bold text-stone-400 uppercase tracking-wide">📷 Take a photo first to confirm delivery</p>
              )}

              {/* COULDN'T DELIVER */}
              <button
                onClick={() => setShowFailFlow(true)}
                className="w-full py-4 border-2 border-stone-300 text-stone-600 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95 active:border-stone-400"
              >
                <XCircle size={18} /> COULDN'T DELIVER — REPORT ATTEMPT
              </button>
            </div>
          </div>
        )}

        {/* ── COMPLETED: POD summary ── */}
        {isCompleted && (() => {
          // Support both old field name (photo) and new (confirmationPhoto)
          const podPhoto = order.confirmationPhoto || (order as any).photo || null;
          const podSig = order.confirmationSignature || (order as any).signature || null;
          const podNotes = order.driverNotes || (order as any).notes || null;
          return (
          <div className="mx-3 mt-3 mb-4 space-y-2">
            {/* Status + timestamp card */}
            <div className="bg-white rounded-xl border border-stone-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <StatusBadge status={order.status} />
                <span className="text-[10px] font-black uppercase text-stone-400">Proof of Delivery</span>
              </div>
              {order.completedAt && (
                <p className="text-xs font-bold text-stone-600 mt-2">
                  🕐 {new Date(order.completedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(order.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              {!order.completedAt && (
                <p className="text-[10px] text-stone-400 mt-1 italic">No timestamp recorded</p>
              )}
              {podNotes && <p className="text-sm italic text-stone-600 mt-2">"{podNotes}"</p>}
              {order.driverId && <p className="text-[10px] text-stone-400 mt-1">Driver: {order.driverName || order.driverId}</p>}
            </div>
            {/* Photo */}
            {podPhoto ? (
              <div className="rounded-xl overflow-hidden border border-stone-200">
                <div className="bg-stone-100 px-3 py-2">
                  <p className="text-[9px] font-black uppercase text-stone-500">📷 Delivery Photo</p>
                </div>
                <img src={podPhoto} className="w-full max-h-64 object-cover" alt="Delivery Photo" />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 px-4 py-3 flex items-center gap-2">
                <span className="text-lg">📷</span>
                <p className="text-xs text-stone-400 font-bold">No delivery photo on file</p>
              </div>
            )}
            {/* Signature */}
            {podSig ? (
              <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
                <div className="bg-stone-100 px-3 py-2">
                  <p className="text-[9px] font-black uppercase text-stone-500">✍️ Signature</p>
                </div>
                <div className="p-3">
                  <img src={podSig} className="w-full max-h-24 object-contain" alt="Signature" />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-stone-200 px-4 py-3 flex items-center gap-2">
                <span className="text-lg">✍️</span>
                <p className="text-xs text-stone-400 font-bold">No signature on file</p>
              </div>
            )}
            {/* Admin: REVERT accidentally confirmed delivery */}
            {isAdmin && order.status === DeliveryStatus.DELIVERED && !order.successNotificationSent && (
              !showRevertConfirm ? (
                <button onClick={() => setShowRevertConfirm(true)}
                  className="w-full py-3 bg-stone-100 text-stone-500 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 active:scale-95 border border-stone-200">
                  ↩ Undo — Marked Delivered by Mistake
                </button>
              ) : (
                <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-4 space-y-3">
                  <p className="text-red-700 font-black text-sm text-center uppercase">⚠ Revert to Driver Assigned?</p>
                  <p className="text-red-600 text-xs text-center">This will clear the photo, signature, and DELIVERED status. Cannot be undone.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setShowRevertConfirm(false)}
                      className="flex-1 py-3 bg-stone-100 text-stone-600 rounded-xl font-black uppercase text-xs">Cancel</button>
                    <button onClick={handleRevert}
                      className="flex-1 py-3 bg-red-600 text-white rounded-xl font-black uppercase text-xs">Yes, Revert</button>
                  </div>
                </div>
              )
            )}
            {/* Admin: send notification */}
            {isAdmin && order.status === DeliveryStatus.DELIVERED && !order.successNotificationSent && !showRevertConfirm && (
              !showSendConfirm ? (
                <button onClick={() => setShowSendConfirm(true)}
                  className="w-full py-2.5 bg-stone-100 text-stone-500 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 active:scale-95 border border-stone-200">
                  <Bell size={13} /> Send Delivery Confirmation to Customer
                </button>
              ) : (
                <div className="bg-stone-900 rounded-2xl p-4 space-y-3">
                  <p className="text-white font-black text-sm text-center uppercase">📧 Send confirmation to customer?</p>
                  <p className="text-stone-400 text-xs text-center">This will email the customer that their order was delivered. Make sure the delivery actually happened first.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setShowSendConfirm(false)}
                      className="flex-1 py-3 bg-stone-700 text-white rounded-xl font-black uppercase text-xs">Cancel</button>
                    <button onClick={() => { setShowSendConfirm(false); loadPreview('SUCCESS'); }}
                      className="flex-1 py-3 bg-green-500 text-white rounded-xl font-black uppercase text-xs">Yes, Preview & Send</button>
                  </div>
                </div>
              )
            )}
            {isAdmin && (order.status === DeliveryStatus.FAILED || order.status === DeliveryStatus.PENDING_RESCHEDULE) && !order.failureNotificationSent && (
              <button onClick={() => loadPreview('FAILURE')}
                className="w-full py-3.5 bg-stone-800 text-white rounded-xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95">
                <Bell size={16} /> Notify Customer of Delay
              </button>
            )}
            {order.failureNotificationSent && (
              <p className="text-center text-xs font-bold text-green-600">✓ Customer notified</p>
            )}
            {order.successNotificationSent && (
              <p className="text-center text-xs font-bold text-green-600">✓ Delivery confirmation sent</p>
            )}
          </div>
          );
        })()}

        {/* ── PREVIOUS ATTEMPTS ── */}
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

        {/* ── ADMIN SECTION — collapsed at bottom ── */}
        {isAdmin && (
          <div className="mx-3 mt-3 bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="px-4 py-2 bg-stone-50 border-b border-stone-100 flex items-center justify-between">
              <p className="text-[10px] font-black uppercase text-stone-500 tracking-widest">Admin</p>
              <button onClick={() => setEditingContact(e => !e)}
                className={`text-[10px] font-black uppercase px-3 py-1 rounded-full transition-all ${editingContact ? 'bg-black text-white' : 'bg-stone-100 text-stone-600'}`}>
                <Edit3 size={10} className="inline mr-1" />{editingContact ? 'Editing' : 'Edit Info'}
              </button>
            </div>

            {editingContact && (
              <div className="px-4 py-3 border-b border-stone-100 space-y-2">
                <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-2">Recipient</p>
                <input value={editFields.recipientName} onChange={e => setEditFields(p => ({ ...p, recipientName: e.target.value }))} placeholder="Recipient name" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <input value={editFields.recipientPhone} onChange={e => setEditFields(p => ({ ...p, recipientPhone: e.target.value }))} placeholder="Recipient phone" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <input value={editFields.recipientEmail} onChange={e => setEditFields(p => ({ ...p, recipientEmail: e.target.value }))} placeholder="Recipient email" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2 mb-2">Sender</p>
                <input value={editFields.senderName} onChange={e => setEditFields(p => ({ ...p, senderName: e.target.value }))} placeholder="Sender name" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <input value={editFields.senderPhone} onChange={e => setEditFields(p => ({ ...p, senderPhone: e.target.value }))} placeholder="Sender phone" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2 mb-2">Address</p>
                <input value={editFields.street} onChange={e => setEditFields(p => ({ ...p, street: e.target.value }))} placeholder="Street address" className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={editFields.city} onChange={e => setEditFields(p => ({ ...p, city: e.target.value }))} placeholder="City" className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                  <input value={editFields.zip} onChange={e => setEditFields(p => ({ ...p, zip: e.target.value.replace(/\D/g,'').slice(0,5) }))} placeholder="ZIP" className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-black" />
                </div>
                {role === 'SUPER_ADMIN' && (
                  <div>
                    <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mt-2 mb-2">Delivery Fee (Super Admin only)</p>
                    <input value={editFields.deliveryFee} onChange={e => setEditFields(p => ({ ...p, deliveryFee: e.target.value }))} placeholder="Fee ($)" inputMode="decimal" className="w-full bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-amber-400" />
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={handleSaveContact} className="flex-1 py-3 bg-black text-white rounded-xl font-black uppercase text-xs">Save Changes</button>
                  <button onClick={() => setEditingContact(false)} className="flex-1 py-3 bg-stone-100 text-stone-600 rounded-xl font-black uppercase text-xs">Cancel</button>
                </div>
              </div>
            )}

            <div className="px-4 py-3 border-b border-stone-100">
              <p className="text-xs font-black text-stone-500">Driver: <span className="text-stone-900 font-black">{order.driverName || 'Not assigned'}</span></p>
              <p className="text-[10px] text-stone-400 mt-0.5">To reassign, use the Schedule or Orders list view</p>
            </div>

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
              <p className="text-[10px] font-bold text-stone-400 uppercase">Sending via: {notifyChannel}</p>
              {notifySent ? (
                <p className="text-center font-black text-green-600">✓ Sent!</p>
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

      {isSigning && (
        <SignaturePad onSave={(sig) => { setSigData(sig); setIsSigning(false); }} onCancel={() => setIsSigning(false)} />
      )}

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
  const [rescheduleOrder, setRescheduleOrder] = useState<Delivery | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleSaved, setRescheduleSaved] = useState(false);
  const [showAddManual, setShowAddManual] = useState(false);
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
    // Sort by delivery date ASC, then order number ASC — so groups are clean
    const sorted = [...deliveries].sort((a, b) => {
      const da = (a.deliveryDate || '9999').split('T')[0];
      const db = (b.deliveryDate || '9999').split('T')[0];
      if (da !== db) return da.localeCompare(db);
      return (a.orderNumber || '').localeCompare(b.orderNumber || '');
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
      // Status filter
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
        d.giftReceiverName?.toLowerCase().includes(q) ||
        statusLabel.includes(q)
      );
    });

    return (<>
      <div className="flex flex-col h-full">
        {/* Stats + Add button */}
        <div className="border-b border-stone-200">
          <div className="grid grid-cols-3 border-b border-stone-100">
            {[
              { label: 'Open', val: deliveries.filter(d => OPEN_STATUSES.includes(d.status)).length, color: 'text-blue-600' },
              { label: 'Out for Delivery', val: inTransitCount, color: 'text-black' },
              { label: 'Done Today', val: deliveredTodayCount, color: 'text-green-600' },
            ].map(s => (
              <div key={s.label} className="py-3 text-center border-r border-stone-100 last:border-0">
                <p className={`text-xl font-black ${s.color}`}>{s.val}</p>
                <p className="text-[8px] font-black uppercase text-stone-400 leading-tight px-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Filters + Search */}
        <div className="px-3 pt-2 pb-2 border-b border-stone-200 space-y-2">
          {/* Driver filter dropdown */}
          <select value={ordersDriverFilter} onChange={e => setOrdersDriverFilter(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-black">
            {uniqueOrderDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {/* Active / Delivered toggle — Active on left */}
          <div className="flex gap-2">
            <button onClick={() => setStatusFilter('OPEN')}
              className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase transition-all ${statusFilter === 'OPEN' ? 'bg-blue-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
              Active ({deliveries.filter(d => OPEN_STATUSES.includes(d.status)).length})
            </button>
            <button onClick={() => setStatusFilter('CLOSED')}
              className={`flex-1 py-2.5 rounded-xl font-black text-xs uppercase transition-all ${statusFilter === 'CLOSED' ? 'bg-green-600 text-white' : 'bg-stone-100 text-stone-500'}`}>
              ✓ Delivered ({deliveries.filter(d => CLOSED_STATUSES.includes(d.status)).length})
            </button>
          </div>
          {/* Text search */}
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, order #, address, status..."
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black"
          />
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[70px_1fr_100px] bg-stone-50 border-b border-stone-200 px-3 py-2">
          <p className="text-[9px] font-black uppercase text-stone-600">Order #</p>
          <p className="text-[9px] font-black uppercase text-stone-600">Recipient · City · Product</p>
          <p className="text-[9px] font-black uppercase text-stone-600 text-right">Driver · Status</p>
        </div>

        {/* Rows with day separators */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Package size={32} className="text-stone-200 mb-2" />
              <p className="text-xs font-black uppercase text-stone-300">No orders found</p>
            </div>
          ) : search ? (
            // SEARCH MODE: Simple list, no date grouping
            filtered.map((order, idx) => {
              const statusCfg = STATUSES_FOR_DROPDOWN.find(s => s.value === order.status) || STATUSES_FOR_DROPDOWN[0];
              return (
                <div key={order.id}
                  className={`grid grid-cols-[70px_1fr_100px] px-3 py-3 border-b border-stone-100 active:bg-stone-50 cursor-pointer ${idx % 2 === 0 ? 'bg-white' : 'bg-stone-50/30'}`}
                  onClick={() => onSelectOrder(order)}>
                  {/* Col 1: order# + date */}
                  <div>
                    <p className="text-sm font-black text-black leading-tight">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
                    <p className="text-[10px] font-bold text-stone-500 mt-0.5">{order.deliveryDate ? fmtDate(order.deliveryDate) : '—'}</p>
                  </div>
                  {/* Col 2: recipient name + city + product */}
                  <div className="min-w-0 px-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <p className="text-sm font-black text-stone-900 leading-tight truncate">{order.giftReceiverName || order.customer?.name}</p>
                      {renderAttemptBadge(order)}
                      {(order as any).isManual && <span className="px-1 py-0.5 bg-violet-100 text-violet-700 text-[8px] font-black rounded">Manual</span>}
                    </div>
                    <p className="text-xl font-black text-black mt-0.5 leading-tight">{order.address?.city}{order.address?.zip ? ` ${order.address.zip}` : ''}</p>
                    <p className="text-[10px] text-stone-400 truncate">{order.address?.street}</p>
                    {order.items?.[0] && <p className="text-[10px] text-stone-500 truncate">{order.items[0].name}</p>}
                    {order.deliveryInstructions && (
                      <div className="flex items-center gap-1 mt-0.5 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                        <AlertTriangle size={8} className="text-red-600 shrink-0" />
                        <p className="text-[9px] font-black text-red-700 truncate">{order.deliveryInstructions}</p>
                      </div>
                    )}
                  </div>
                  {/* Col 3: driver + status dot (no big badge) */}
                  <div className="text-right" onClick={e => e.stopPropagation()}>
                    <p className="text-[10px] font-bold text-stone-500 truncate">{order.driverName || '—'}</p>
                    <select
                      value={order.status}
                      onChange={e => {
                        const newStatus = e.target.value as DeliveryStatus;
                        onUpdateOrder(order.id, { status: newStatus });
                        const isManualOrder = (order as any).isManual;
                        fetch(isManualOrder ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/status`, {
                          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: newStatus })
                        }).catch(() => {});
                      }}
                      style={{ backgroundColor: statusCfg.color, color: 'white' }}
                      className="mt-1 w-full text-[9px] font-black rounded-lg px-1 py-1 outline-none border-0 appearance-none cursor-pointer"
                    >
                      {STATUSES_FOR_DROPDOWN.map(s => (
                        <option key={s.value} value={s.value} style={{ backgroundColor: s.color, color: 'white' }}>{s.label}</option>
                      ))}
                    </select>
                  </div>
              </div>
              );
            })
          ) : (() => {
            // NORMAL MODE: Group by delivery date with day separators
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
                  className={`grid grid-cols-[70px_1fr_100px] px-3 py-3 border-b border-stone-100 active:bg-stone-50 cursor-pointer ${idx % 2 === 0 ? 'bg-white' : 'bg-stone-50/30'}`}
                  onClick={() => onSelectOrder(order)}>
                  {/* Col 1: order# + date */}
                  <div>
                    <p className="text-sm font-black text-black leading-tight">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
                    <p className="text-[10px] font-bold text-stone-500 mt-0.5">{order.deliveryDate ? fmtDate(order.deliveryDate) : '—'}</p>
                  </div>
                  {/* Col 2: recipient name + city + product */}
                  <div className="min-w-0 px-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <p className="text-sm font-black text-stone-900 leading-tight truncate">{order.giftReceiverName || order.customer?.name}</p>
                      {renderAttemptBadge(order)}
                      {(order as any).isManual && <span className="px-1 py-0.5 bg-violet-100 text-violet-700 text-[8px] font-black rounded">Manual</span>}
                    </div>
                    <p className="text-xl font-black text-black mt-0.5 leading-tight">{order.address?.city}{order.address?.zip ? ` ${order.address.zip}` : ''}</p>
                    <p className="text-[10px] text-stone-400 truncate">{order.address?.street}</p>
                    {order.items?.[0] && <p className="text-[10px] text-stone-500 truncate">{order.items[0].name}</p>}
                    {order.deliveryInstructions && (
                      <div className="flex items-center gap-1 mt-0.5 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                        <AlertTriangle size={8} className="text-red-600 shrink-0" />
                        <p className="text-[9px] font-black text-red-700 truncate">{order.deliveryInstructions}</p>
                      </div>
                    )}
                  </div>
                  {/* Col 3: driver + status dot (no big badge) */}
                  <div className="text-right" onClick={e => e.stopPropagation()}>
                    <p className="text-[10px] font-bold text-stone-500 truncate">{order.driverName || '—'}</p>
                    <select
                      value={order.status}
                      onChange={e => {
                        const newStatus = e.target.value as DeliveryStatus;
                        onUpdateOrder(order.id, { status: newStatus });
                        const isManualOrder = (order as any).isManual;
                        fetch(isManualOrder ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/status`, {
                          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: newStatus })
                        }).catch(() => {});
                      }}
                      style={{ backgroundColor: statusCfg.color, color: 'white' }}
                      className="mt-1 w-full text-[9px] font-black rounded-lg px-1 py-1 outline-none border-0 appearance-none cursor-pointer"
                    >
                      {STATUSES_FOR_DROPDOWN.map(s => (
                        <option key={s.value} value={s.value} style={{ backgroundColor: s.color, color: 'white' }}>{s.label}</option>
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
                  {renderAttemptBadge(order)}
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
}> = ({ stops, driverLat, driverLng, onClose, onStartNav, totalDistance }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);

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
    const allPoints: [number, number][] = [[driverLat, driverLng]];
    stops.forEach(s => {
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
        <button onClick={onClose} className="w-9 h-9 bg-stone-100 rounded-full flex items-center justify-center">
          <X size={18} className="text-stone-600" />
        </button>
      </div>

      {/* Map */}
      <div ref={mapRef} className="flex-1" style={{ minHeight: 200 }} />

      {/* Stop list */}
      <div className="bg-white max-h-[35vh] overflow-y-auto border-t border-stone-200">
        {stops.map(s => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-stone-100">
            <div className="w-7 h-7 bg-black rounded-full flex items-center justify-center shrink-0">
              <span className="text-white font-black text-xs">{s.stopNumber}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-black text-stone-900 truncate">{s.name}</p>
              <p className="text-[10px] text-stone-400 truncate">{s.address}</p>
            </div>
            <p className="text-[10px] font-black text-stone-400">#{s.orderNumber?.replace(/^#+/, '')}</p>
          </div>
        ))}
      </div>

      {/* Navigation buttons */}
      <div className="bg-white px-4 py-3 border-t border-stone-200 flex gap-2 safe-bottom">
        <button onClick={() => onStartNav('waze')}
          className="flex-1 py-3.5 bg-[#33ccff] text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95">
          <Navigation size={16} /> Waze
        </button>
        <button onClick={() => onStartNav('google')}
          className="flex-1 py-3.5 bg-[#4285F4] text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95">
          <MapIcon size={16} /> Google Maps
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

  return (
    <div className="px-3 pb-3 pt-0 space-y-1.5 bg-inherit" onClick={e => e.stopPropagation()}>
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
            await fetch(isManual ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/assign`, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ driverId: u.id, driverName: u.name })
            });
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
              await fetch(isManual ? `/api/manual-orders/${order.id}` : `/api/orders/${order.id}/edit`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deliveryDate: localDate })
              });
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
  const [statusFilter, setStatusFilter] = useState<'OPEN'|'DONE'|'ALL'>('OPEN');

  // Route optimization state
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeStatus, setRouteStatus] = useState('');
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [routeStops, setRouteStops] = useState<any[]>([]);
  const [routeTotalDist, setRouteTotalDist] = useState(0);
  const [driverLat, setDriverLat] = useState(25.946);
  const [driverLng, setDriverLng] = useState(-80.155);

  const activeDrivers = useMemo(() =>
    allUsers.filter(u => (u.role === 'DRIVER' || u.role === 'MANAGER') && u.isActive),
    [allUsers]
  );

  const OPEN_STATUSES = ['PENDING','ASSIGNED','IN_TRANSIT','SCHEDULED','SECOND_ATTEMPT','FAILED','PENDING_RESCHEDULE'];
  const DONE_STATUSES = ['DELIVERED','CLOSED'];

  // Filter deliveries
  const filtered = useMemo(() => {
    return deliveries.filter(d => {
      // Driver filter
      if (!isAdmin) {
        if (d.driverId !== currentUserId && d.driverId !== 'manager_1') return false;
      } else if (driverFilter !== 'ALL') {
        if (d.driverId !== driverFilter) return false;
      }
      // Status filter
      if (statusFilter === 'OPEN' && !OPEN_STATUSES.includes(d.status)) return false;
      if (statusFilter === 'DONE' && !DONE_STATUSES.includes(d.status)) return false;
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
  }, [deliveries, driverFilter, statusFilter, search, isAdmin, currentUserId]);

  // Group by date, sorted ascending
  const grouped = useMemo(() => {
    const map: Record<string, Delivery[]> = {};
    filtered.forEach(d => {
      const key = (d.deliveryDate || 'unscheduled').split('T')[0];
      if (!map[key]) map[key] = [];
      map[key].push(d);
    });
    return Object.entries(map).sort(([a], [b]) => {
      if (a === 'unscheduled') return 1;
      if (b === 'unscheduled') return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  // Get active (not delivered) stops for route optimization
  const optimizableStops = useMemo(() =>
    filtered.filter(d => !['DELIVERED','CLOSED'].includes(d.status)),
    [filtered]
  );

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
      setRouteTotalDist(data.totalDistance || 0);
      setRouteStops(ordered);
      setShowRouteMap(true);
    } catch {
      // Even if optimize fails, show the map with stops in list order
      setRouteStops(withCoords.map((d: Delivery, idx: number) => ({
        id: d.id, stopNumber: idx + 1,
        lat: d.address.lat, lng: d.address.lng,
        name: d.giftReceiverName || d.customer?.name || '—',
        address: `${d.address?.street}, ${d.address?.city}`,
        orderNumber: d.orderNumber || d.id,
      })));
      setShowRouteMap(true);
    }
    setRouteLoading(false);
    setRouteStatus('');
  };

  const startNavigation = (app: 'waze' | 'google') => {
    if (routeStops.length === 0) return;
    if (app === 'waze') {
      const first = routeStops[0];
      window.open(`https://waze.com/ul?ll=${first.lat},${first.lng}&navigate=yes`, '_blank');
    } else {
      const dest = routeStops[routeStops.length - 1];
      const waypoints = routeStops.slice(0, -1).map((s: any) => `${s.lat},${s.lng}`).join('|');
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
      label: isToday ? 'TODAY' : isTomorrow ? 'TOMORROW' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase(),
      sub: d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      isToday,
      isTomorrow,
    };
  };

  return (
    <div className="flex flex-col h-full bg-stone-50">

      {/* ── STICKY HEADER ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-4 pt-3 pb-3 space-y-2.5 shadow-sm">

        {/* Search */}
        <div className="relative">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, order #, city, ZIP, driver..."
            className="w-full bg-stone-50 border-2 border-stone-200 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-black pr-9"
          />
          {search
            ? <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400"><X size={16} /></button>
            : <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300 text-base">🔍</span>
          }
        </div>

        {/* Driver filter (admin only) + status toggle */}
        <div className="flex gap-2 items-center">
          {isAdmin && (
            <select value={driverFilter} onChange={e => setDriverFilter(e.target.value)}
              className="flex-1 bg-stone-50 border-2 border-stone-200 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-black">
              <option value="ALL">All Drivers ({deliveries.filter(d => OPEN_STATUSES.includes(d.status)).length} open)</option>
              {activeDrivers.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} ({deliveries.filter(d => d.driverId === u.id && OPEN_STATUSES.includes(d.status)).length} open)
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Status tabs */}
        <div className="flex gap-1.5">
          {([
            { key: 'OPEN', label: `Active`, count: deliveries.filter(d => OPEN_STATUSES.includes(d.status) && (driverFilter === 'ALL' || d.driverId === driverFilter)).length },
            { key: 'DONE', label: `Delivered`, count: deliveries.filter(d => DONE_STATUSES.includes(d.status) && (driverFilter === 'ALL' || d.driverId === driverFilter)).length },
            { key: 'ALL',  label: `All`, count: deliveries.filter(d => driverFilter === 'ALL' || d.driverId === driverFilter).length },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setStatusFilter(f.key)}
              className={`flex-1 py-2 rounded-xl font-black text-xs uppercase transition-all ${
                statusFilter === f.key
                  ? f.key === 'OPEN' ? 'bg-black text-white' : f.key === 'DONE' ? 'bg-green-600 text-white' : 'bg-stone-600 text-white'
                  : 'bg-stone-100 text-stone-500'
              }`}>
              {f.label} ({f.count})
            </button>
          ))}
        </div>
      </div>

      {/* ── MAP + OPTIMIZE ROUTE BUTTON ── */}
      {optimizableStops.length > 0 && (
        <div className="px-4 py-3 bg-stone-50 border-b border-stone-200">
          <button
            onClick={optimizeRoute}
            disabled={routeLoading}
            className="w-full py-4 bg-black text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 disabled:opacity-60 transition-all"
          >
            {routeLoading ? (
              <><RefreshCw size={16} className="animate-spin" /> {routeStatus || 'Loading...'}</>
            ) : (
              <><MapIcon size={16} /> 🗺 Map + Optimize Route ({optimizableStops.length} stops)</>
            )}
          </button>
        </div>
      )}

      {/* ── ROUTE MAP OVERLAY ── */}
      {showRouteMap && (
        <RouteMapPanel
          stops={routeStops}
          driverLat={driverLat}
          driverLng={driverLng}
          totalDistance={routeTotalDist}
          onClose={() => setShowRouteMap(false)}
          onStartNav={startNavigation}
        />
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
          return (
            <div key={dateKey}>
              {/* Date group header */}
              <div className={`px-4 py-2.5 flex items-center justify-between sticky top-0 z-[5] ${hdr.isToday ? 'bg-black' : hdr.isTomorrow ? 'bg-stone-800' : 'bg-stone-700'}`}>
                <div>
                  <p className="text-white font-black text-sm tracking-wide">{hdr.label}</p>
                  {hdr.sub && <p className="text-stone-400 text-[10px] font-bold">{hdr.sub}</p>}
                </div>
                <span className="text-white font-black text-xs bg-white/20 px-2 py-0.5 rounded-full">{orders.length} orders</span>
              </div>

              {/* Cards for this date */}
              {orders.map(order => {
                const name = order.giftReceiverName || order.customer?.name || '—';
                const cleanNum = (order.orderNumber || order.id).replace(/^#+/, '');
                const fee = order.deliveryFee || DELIVERY_FEES[order.address?.zip || ''] || 0;
                const statusCfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING;
                const isDone = DONE_STATUSES.includes(order.status);

                return (
                  <div key={order.id} className={`border-b border-stone-100 ${isDone ? 'bg-green-50' : 'bg-white'}`}>
                    {/* Main card row — tappable */}
                    <div className="flex items-stretch cursor-pointer active:bg-stone-50" onClick={() => onSelectOrder(order)}>
                      {/* Status stripe */}
                      <div className={`w-1.5 shrink-0 ${statusCfg.bg}`} />
                      <div className="flex-1 px-3 py-3 min-w-0">
                        <div className="flex items-start gap-2">
                          {/* Left: all order info */}
                          <div className="flex-1 min-w-0">
                            {/* Order number + status badge (only if not Assigned/Pending) */}
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-[11px] font-black text-stone-400">#{cleanNum}</p>
                              {!['PENDING','ASSIGNED'].includes(order.status) && (
                                <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${statusCfg.bg} ${statusCfg.text}`}>{statusCfg.label}</span>
                              )}
                              {(order as any).isManual && <span className="text-[9px] font-black px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full">Manual</span>}
                            </div>
                            {/* Recipient name */}
                            <p className="text-base font-black text-stone-900 leading-tight truncate">{name}</p>
                            {/* CITY — big and bold */}
                            <p className="text-2xl font-black text-black leading-tight">{order.address?.city || '—'} <span className="text-base font-bold text-stone-500">{order.address?.zip}</span></p>
                            {/* Street — small */}
                            <p className="text-xs text-stone-400 font-medium truncate">{order.address?.street}{order.address?.unit ? `, ${order.address.unit}` : ''}</p>
                            {/* Product */}
                            {order.items?.[0] && <p className="text-[11px] text-stone-500 truncate mt-0.5">{order.items[0].name}</p>}
                            {/* Real delivery instructions only */}
                            {order.deliveryInstructions && (
                              <div className="flex items-center gap-1 mt-1 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                                <AlertTriangle size={10} className="text-red-600 shrink-0" />
                                <p className="text-[10px] font-black text-red-700 truncate">{order.deliveryInstructions}</p>
                              </div>
                            )}
                          </div>
                          {/* Right: done indicator only */}
                          {isDone && (
                            <div className="shrink-0 text-right pt-5">
                              <p className="text-[10px] font-black text-green-600">✓ DONE</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Admin action row: driver + date change */}
                    {isAdmin && (
                      <OrderAdminRow
                        order={order}
                        allUsers={allUsers}
                        activeDrivers={activeDrivers}
                        onUpdateOrder={onUpdateOrder}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};



// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES PANEL — templates + sent history
// ─────────────────────────────────────────────────────────────────────────────

const MessagesPanel: React.FC<{ role: AppRole }> = ({ role }) => {
  const [subTab, setSubTab] = useState<'HISTORY' | 'TEMPLATES'>('HISTORY');
  const [messages, setMessages] = useState<any[]>([]);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null);
  const [todayOnly, setTodayOnly] = useState(true);
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

      {/* ── INTEGRATION STATUS BANNER — SUPER ADMIN ONLY ── */}
      {role === 'SUPER_ADMIN' && configStatus && (
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

      {/* ── TEST SEND — SUPER ADMIN ONLY ── */}
      {role === 'SUPER_ADMIN' && (
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
      )}

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
      {subTab === 'HISTORY' && (() => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const filtered = todayOnly ? messages.filter(m => (m.sentAt || '').startsWith(todayStr)) : messages;
        const todayCount = messages.filter(m => (m.sentAt || '').startsWith(todayStr)).length;
        const todayDelivered = messages.filter(m => (m.sentAt || '').startsWith(todayStr) && m.type === 'SUCCESS').length;
        const todayFailed = messages.filter(m => (m.sentAt || '').startsWith(todayStr) && m.type !== 'SUCCESS').length;
        return (
          <div className="space-y-3">
            {/* TODAY STATS BANNER */}
            <div className="bg-black rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase text-white/40 tracking-widest mb-1">Today's Sent Messages</p>
                <p className="text-3xl font-black text-white">{todayCount}</p>
              </div>
              <div className="flex gap-3">
                <div className="text-right">
                  <p className="text-[9px] font-black uppercase text-green-400/70 tracking-widest">Delivered</p>
                  <p className="text-xl font-black text-green-400">{todayDelivered}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black uppercase text-red-400/70 tracking-widest">Delay</p>
                  <p className="text-xl font-black text-red-400">{todayFailed}</p>
                </div>
              </div>
            </div>

            {/* TODAY / ALL toggle */}
            <div className="flex gap-2 bg-stone-100 rounded-2xl p-1">
              <button onClick={() => setTodayOnly(true)}
                className={`flex-1 py-2.5 rounded-xl font-black uppercase text-[10px] transition-all ${todayOnly ? 'bg-white text-black shadow-sm' : 'text-stone-400'}`}>
                Today Only
              </button>
              <button onClick={() => setTodayOnly(false)}
                className={`flex-1 py-2.5 rounded-xl font-black uppercase text-[10px] transition-all ${!todayOnly ? 'bg-white text-black shadow-sm' : 'text-stone-400'}`}>
                All History
              </button>
            </div>

            {loadingMsgs && (
              <div className="flex items-center justify-center py-12">
                <RefreshCw size={22} className="animate-spin text-stone-300" />
              </div>
            )}
            {!loadingMsgs && filtered.length === 0 && (
              <div className="text-center py-12">
                <MessageCircle size={32} className="mx-auto text-stone-200 mb-2" />
                <p className="text-[11px] font-black uppercase text-stone-300">{todayOnly ? 'No messages sent today' : 'No messages sent yet'}</p>
              </div>
            )}
            {filtered.map((msg: any) => (
              <div key={msg.id} className="bg-white border border-stone-100 rounded-[24px] shadow-sm overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-stone-50">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full ${msg.type === 'SUCCESS' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {msg.type === 'SUCCESS' ? '✓ Delivered' : '✗ Delay'}
                    </span>
                    <span className="text-[9px] font-black uppercase px-2.5 py-1 rounded-full bg-stone-100 text-stone-500">
                      {msg.channel === 'SMS' ? '📱 SMS' : '✉️ Email'}
                    </span>
                  </div>
                  <span className="text-[9px] font-black text-stone-400">
                    {msg.sentAt ? new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
                {/* Details */}
                <div className="px-5 py-3 space-y-1">
                  <p className="font-black text-stone-900 text-sm">{msg.customerName}</p>
                  <p className="text-[10px] font-black text-stone-400 uppercase">Order #{msg.orderNumber} · Driver: {msg.driverName}</p>
                  <p className="text-[10px] text-stone-400">{msg.to}</p>
                </div>
                {/* Message body — collapsible */}
                <details className="px-5 pb-4">
                  <summary className="text-[10px] font-black uppercase text-stone-400 cursor-pointer select-none">View message</summary>
                  <p className="mt-2 text-xs text-stone-600 leading-relaxed bg-stone-50 rounded-xl p-3 whitespace-pre-line">{msg.message}</p>
                </details>
              </div>
            ))}
          </div>
        );
      })()}

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
              <input type="text" placeholder="Vehicle" value={newDriver.vehicle} onChange={e => setNewDriver(p => ({ ...p, vehicle: e.target.value }))} className="w-full bg-stone-50 border border-stone-100 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black" />
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

        {activeTab === 'MESSAGES' && <MessagesPanel role={role} />}

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
            const isInRange = dateToCheck >= calcStart && dateToCheck <= calcEnd;
            
            // DEBUG: Log each order being considered
            if (isInRange) {
              console.log('FEE CALC - Including:', {
                order: d.orderNumber,
                driver: d.driverName || 'Unassigned',
                driverId: d.driverId || 'none',
                fee: d.deliveryFee,
                date: dateToCheck,
                zip: d.address.zip
              });
            }
            
            return isInRange;
          }) : [];

          // group by driver
          const byDriver: Record<string, { name: string; stops: Delivery[] }> = {};
          inRange.forEach(d => {
            const key = d.driverId || 'unassigned';
            const name = d.driverName || 'Unassigned';
            if (!byDriver[key]) byDriver[key] = { name, stops: [] };
            byDriver[key].stops.push(d);
          });

          const driverRows = Object.entries(byDriver).map(([id, { name, stops }]) => {
            const total = stops.reduce((s, d) => s + (d.deliveryFee || 0), 0);
            console.log('DRIVER TOTALS:', {
              id,
              name,
              count: stops.length,
              total,
              fees: stops.map(d => d.deliveryFee)
            });
            return {
              id, name,
              count: stops.length,
              total,
              stops
            };
          }).sort((a, b) => b.total - a.total);


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

  const myDeliveries = (isDriver || currentUser.role === 'MANAGER')
    ? deliveries.filter(d => d.driverId === currentUser.id || d.driverId === 'manager_1' && currentUser.role === 'MANAGER')
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
  const [podSignature, setPodSignature] = useState<string | null>(null);
  const [showSigPad, setShowSigPad] = useState(false);
  const [showFailedFlow, setShowFailedFlow] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [failNotes, setFailNotes] = useState('');
  const [feeFilter, setFeeFilter] = useState<{ driver?: string; brand?: string; dateFrom?: string; dateTo?: string }>({});
  const [calendarDate, setCalendarDate] = useState(new Date().toISOString().split('T')[0]);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

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
              <button onClick={() => photoInputRef.current?.click()} className="w-full py-8 border-2 border-dashed border-stone-300 rounded-xl text-stone-400 font-bold flex flex-col items-center gap-2">
                <Camera size={28} /><span>Take Photo</span>
              </button>
            )}
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoCapture} />
          </div>
          <div className="mb-4">
            <p className="font-black text-sm mb-2 uppercase text-stone-500">✍️ Signature</p>
            {podSignature ? (
              <div className="relative">
                <img src={podSignature} alt="Sig" className="w-full rounded-xl bg-white border border-stone-200" style={{ maxHeight: 120 }} />
                <button onClick={() => setPodSignature(null)} className="absolute top-2 right-2 bg-red-500 text-white w-7 h-7 rounded-full flex items-center justify-center"><X size={14} /></button>
              </div>
            ) : showSigPad ? (
              <SignaturePad onSave={(d) => { setPodSignature(d); setShowSigPad(false); }} onCancel={() => setShowSigPad(false)} />
            ) : (
              <button onClick={() => setShowSigPad(true)} className="w-full py-6 border-2 border-dashed border-stone-300 rounded-xl text-stone-400 font-bold flex flex-col items-center gap-2">
                <PenTool size={24} /><span>Capture Signature</span>
              </button>
            )}
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
                <Camera size={22} /> 📸 DELIVER — Take Photo + Signature
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
  const [isLoading, setIsLoading] = useState(false);
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
          {/* Delivery Fee ZIP lookup — admin only */}
          {isAdmin && (
            <button onClick={() => { setShowZipBar(s => !s); setZipQuery(''); setZipRate(undefined); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-black text-[11px] uppercase transition-all border-2 ${showZipBar ? 'bg-black text-white border-black' : 'bg-amber-400 text-black border-amber-400'}`}>
              <DollarSign size={13} /> Fee by ZIP
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
          <Truck size={22} />
          <span className="text-[9px] font-black uppercase">Deliveries</span>
          {activeOrders.length > 0 && (
            <span className="absolute top-1.5 right-2 min-w-[18px] h-[18px] bg-black text-white text-[9px] font-black rounded-full flex items-center justify-center px-1">
              {activeOrders.length > 99 ? '99+' : activeOrders.length}
            </span>
          )}
        </button>

        {/* HISTORY */}
        <button onClick={() => setTab('ORDERS')}
          className={`flex-1 py-3 flex flex-col items-center gap-0.5 transition-all ${tab === 'ORDERS' ? 'text-black' : 'text-stone-300'}`}>
          <CheckCircle2 size={22} />
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
            deliveries={deliveries}
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
            deliveries={deliveries}
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

        {/* ── MANAGE TAB — admin only ── */}
        {tab === 'ADMIN' && isAdmin && (
          <div className="pb-24">
            <div className="grid grid-cols-3 border-b border-stone-100">
              {[
                { label: 'Open', val: activeOrders.length, color: 'text-black' },
                { label: 'Out for Delivery', val: inTransitCount, color: 'text-blue-600' },
                { label: 'Done Today', val: deliveredTodayCount, color: 'text-green-600' },
              ].map(s => (
                <div key={s.label} className="py-3 text-center border-r border-stone-100 last:border-0">
                  <p className={`text-2xl font-black ${s.color}`}>{s.val}</p>
                  <p className="text-[8px] font-black uppercase text-stone-400 leading-tight px-1">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="px-4 pt-4 pb-2">
              <button onClick={openAddManual}
                className="w-full py-4 bg-black text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                <Plus size={18} /> Add Delivery Manually
              </button>
            </div>
            <div className="px-4 pt-3 pb-2">
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest mb-2">Drivers & Settings</p>
              <DriversView allUsers={allUsers} setAllUsers={setAllUsers} currentUser={currentUser} />
            </div>
            <div className="px-0 pt-2 pb-2">
              <div className="px-4 mb-2"><p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Bulk Projects</p></div>
              <BulkProjectsView currentUser={currentUser} allUsers={allUsers} />
            </div>
            <div className="px-0 pt-2">
              <div className="px-4 mb-2"><p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Admin Tools</p></div>
              <AdminPanel role={currentUser.role} deliveries={deliveries} allUsers={allUsers} setAllUsers={setAllUsers} />
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
