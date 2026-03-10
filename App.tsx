import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Package, ChevronRight, X, Check, RefreshCw,
  LogOut, Calendar, MapPin, Phone,
  Navigation, CheckCircle2, Send,
  Eye, Camera, PenTool,
  Settings, FileText,
  UserPlus, Users,
  MessageCircle, ChevronLeft, Edit3,
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
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Status badge config
const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  PENDING:             { label: 'Not Assigned',      bg: 'bg-stone-800',   text: 'text-white' },
  ASSIGNED:            { label: 'Driver Assigned',   bg: 'bg-blue-600',    text: 'text-white' },
  IN_TRANSIT:          { label: 'Out for Delivery',  bg: 'bg-black',       text: 'text-white' },
  DELIVERED:           { label: 'Delivered ✓',       bg: 'bg-green-600',   text: 'text-white' },
  FAILED:              { label: 'Failed Delivery',   bg: 'bg-red-600',     text: 'text-white' },
  SECOND_ATTEMPT:      { label: '2nd Attempt',       bg: 'bg-stone-700',   text: 'text-white' },
  PENDING_RESCHEDULE:  { label: 'Needs Reschedule',  bg: 'bg-amber-500',   text: 'text-white' },
  CLOSED:              { label: 'Closed',            bg: 'bg-stone-300',   text: 'text-stone-600' },
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

const OrderCard: React.FC<{ order: Delivery; role: AppRole; onTap: () => void; isSelected?: boolean }> = ({ order, role, onTap, isSelected }) => {
  const isAdmin = role === 'SUPER_ADMIN' || role === 'MANAGER';
  const statusColors: Record<string, string> = {
    PENDING: 'bg-stone-900 text-white',
    ASSIGNED: 'bg-stone-700 text-white',
    IN_TRANSIT: 'bg-black text-white',
    DELIVERED: 'bg-stone-200 text-stone-500',
    FAILED: 'bg-red-600 text-white',
    SECOND_ATTEMPT: 'bg-stone-800 text-white',
    PENDING_RESCHEDULE: 'bg-stone-400 text-white',
  };
  const sc = statusColors[order.status] || 'bg-stone-200 text-stone-600';
  const product = order.items?.[0];
  return (
    <div onClick={onTap}
      className={`mx-3 mb-2 rounded-2xl cursor-pointer active:scale-[0.98] transition-all overflow-hidden border ${isSelected ? 'border-black' : 'border-stone-100'} bg-white shadow-sm`}>
      {/* Status + Order # row */}
      <div className={`px-4 py-2.5 flex items-center justify-between ${sc}`}>
        <div className="flex items-center gap-2">
          <StatusBadge status={order.status} />
          {order.priority === 'Urgent' && <span className="text-[9px] font-black uppercase bg-red-600 text-white px-2 py-0.5 rounded-full">URGENT</span>}
          {order.attemptNumber === 2 && <span className="text-[9px] font-black uppercase bg-white/20 px-2 py-0.5 rounded-full">2ND ATTEMPT</span>}
        </div>
        <span className="text-sm font-black">#{order.orderNumber?.replace(/^#+/, '') || order.id}</span>
      </div>
      {/* Body */}
      <div className="px-4 pt-3 pb-3 space-y-2">
        {/* Address */}
        <div>
          <p className="text-base font-black text-stone-900 leading-tight">{order.address.street}</p>
          <p className="text-sm font-bold text-stone-400">{order.address.city}, FL {order.address.zip}</p>
        </div>
        {/* Special instructions — prominent yellow if present */}
        {order.deliveryInstructions && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <span className="text-amber-600 font-black text-[10px] uppercase shrink-0 mt-0.5">⚠ INSTRUCTIONS</span>
            <p className="text-xs font-black text-amber-900">{order.deliveryInstructions}</p>
          </div>
        )}
        {/* Product */}
        {product && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Package size={12} className="text-stone-400 shrink-0" />
              <p className="text-sm font-black text-stone-800">{product.name}{product.quantity > 1 ? ` ×${product.quantity}` : ''}</p>
            </div>
            {isAdmin && <span className="text-sm font-black text-stone-500">${order.deliveryFee}</span>}
          </div>
        )}
        {/* Recipient → Sender */}
        <div className="flex items-center justify-between pt-1 border-t border-stone-100">
          <p className="text-[11px] font-black text-stone-700">To: {order.giftReceiverName || order.customer.name}</p>
          {order.giftSenderName && <p className="text-[11px] font-bold text-stone-500">From: {order.giftSenderName}</p>}
        </div>
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

  const handleComplete = async () => {
    const now = new Date().toISOString();
    const updates: Partial<Delivery> = { status: DeliveryStatus.DELIVERED, confirmationPhoto: photoData || undefined, confirmationSignature: sigData || undefined, driverNotes: driverNote, completedAt: now, submittedAt: now };
    onUpdate(order.id, updates);
    await fetch('/api/pod', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, photo: photoData, signature: sigData, notes: driverNote, completedAt: now, status: 'DELIVERED', driverId: currentUser.id, driverName: currentUser.name }) });
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
    if (data.rescheduledOrder) onAddDelivery(data.rescheduledOrder);
    onUpdate(order.id, { status: DeliveryStatus.FAILED });
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
    else alert(data.error || 'Failed to send. Check Twilio/SendGrid setup.');
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
  const recipientPhone = order.customer.phone;
  const senderPhone = order.giftSenderPhone;
  const recipientName = order.giftReceiverName || order.customer.name;
  const senderName = order.giftSenderName;
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(order.address.street + ' ' + order.address.city + ' FL ' + order.address.zip)}`;
  const cleanOrderNum = order.orderNumber?.replace(/^#+/, '') || order.id;

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-black text-white px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="p-2 bg-white/10 rounded-full"><ChevronLeft size={20} /></button>
        <div className="flex-1">
          <p className="text-xl font-black">ORDER #{cleanOrderNum}</p>
          <StatusBadge status={order.status} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-10">

        {/* ── ADMIN: ASSIGN DRIVER — very top, most visible ── */}
        {isAdmin && (
          <div className="mx-4 mt-4 bg-stone-900 text-white rounded-2xl px-4 py-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-stone-400 mb-1">Assigned Driver</p>
            <p className="text-lg font-black mb-3">{order.driverName || '⚠ UNASSIGNED'}</p>
            <div className="flex gap-2">
              <select value={reassignTo} onChange={e => setReassignTo(e.target.value)}
                className="flex-1 bg-stone-800 border border-stone-600 text-white rounded-xl px-3 py-2.5 text-sm font-bold outline-none">
                <option value="">Change driver...</option>
                {allUsers.filter(u => u.role === 'DRIVER' && u.isActive).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button onClick={handleReassign} disabled={!reassignTo}
                className="px-5 py-2.5 bg-white text-black rounded-xl font-black text-xs uppercase disabled:opacity-30">Assign</button>
            </div>
          </div>
        )}

        {/* ── SPECIAL INSTRUCTIONS — if present, always first thing driver sees ── */}
        {order.deliveryInstructions && (
          <div className="mx-4 mt-3 bg-amber-400 rounded-2xl px-4 py-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-900 mb-1">⚠ Special Instructions</p>
            <p className="text-base font-black text-amber-950">{order.deliveryInstructions}</p>
          </div>
        )}

        {/* ── PRODUCT — verify at pickup and at door ── */}
        <div className="mx-4 mt-3 bg-stone-950 text-white rounded-2xl px-5 py-4">
          <p className="text-[9px] font-black uppercase tracking-widest text-stone-400 mb-2">What You're Delivering</p>
          {order.items?.length > 0 ? order.items.map((item, i) => (
            <div key={i} className="flex items-start justify-between py-2 border-b border-stone-800 last:border-0">
              <div>
                <p className="text-lg font-black leading-tight">{item.name}</p>
                <p className="text-sm text-stone-400">${item.price.toFixed(2)} each</p>
              </div>
              <span className="text-2xl font-black text-stone-300 shrink-0 ml-4">×{item.quantity}</span>
            </div>
          )) : <p className="text-stone-400 text-sm">No items listed</p>}
          {isAdmin && (
            <div className="mt-3 pt-3 border-t border-stone-800 flex justify-between items-center">
              <p className="text-[9px] font-black uppercase text-stone-400">Delivery Fee</p>
              <p className="text-lg font-black">${order.deliveryFee.toFixed(2)}</p>
            </div>
          )}
        </div>

        {/* ── ADDRESS + MAP ── */}
        <div className="mx-4 mt-3 bg-stone-50 border border-stone-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-stone-400 mb-1">Delivery Address</p>
            <p className="text-lg font-black text-stone-900">{order.address.street}</p>
            <p className="text-sm font-bold text-stone-500">{order.address.city}, FL {order.address.zip}</p>
          </div>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 py-3.5 bg-black text-white font-black uppercase text-sm active:bg-stone-800 transition-all">
            <Navigation size={16} /> Open in Maps
          </a>
        </div>

        {/* ── CONTACTS ── recipient + sender, labeled clearly ── */}
        <div className="mx-4 mt-3 space-y-2">
          <div className="bg-stone-50 rounded-2xl px-4 py-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-stone-400 mb-1">Recipient — Delivering To</p>
            <p className="text-lg font-black text-stone-900 mb-3">{recipientName}</p>
            <div className="grid grid-cols-2 gap-2">
              {recipientPhone
                ? <>
                    <a href={`tel:${recipientPhone}`} className="flex items-center justify-center gap-1.5 py-3.5 bg-black text-white rounded-xl font-black uppercase text-xs active:scale-95">
                      <Phone size={14} /> Call Recipient
                    </a>
                    <a href={`sms:${recipientPhone}`} className="flex items-center justify-center gap-1.5 py-3.5 bg-stone-200 text-stone-900 rounded-xl font-black uppercase text-xs active:scale-95">
                      <MessageCircle size={14} /> Text Recipient
                    </a>
                  </>
                : <p className="text-xs text-stone-400 col-span-2">No phone on file</p>
              }
            </div>
          </div>

          {senderName && (
            <div className="bg-stone-50 rounded-2xl px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-stone-400 mb-1">Gift Sender — Ordered By</p>
              <p className="text-lg font-black text-stone-900 mb-3">{senderName}</p>
              <div className="grid grid-cols-2 gap-2">
                {senderPhone
                  ? <>
                      <a href={`tel:${senderPhone}`} className="flex items-center justify-center gap-1.5 py-3.5 bg-black text-white rounded-xl font-black uppercase text-xs active:scale-95">
                        <Phone size={14} /> Call Sender
                      </a>
                      <a href={`sms:${senderPhone}`} className="flex items-center justify-center gap-1.5 py-3.5 bg-stone-200 text-stone-900 rounded-xl font-black uppercase text-xs active:scale-95">
                        <MessageCircle size={14} /> Text Sender
                      </a>
                    </>
                  : <p className="text-xs text-stone-400 col-span-2">No phone on file</p>
                }
              </div>
            </div>
          )}

          {order.giftMessage && (
            <button onClick={() => setShowGiftMsg(g => !g)}
              className="w-full bg-stone-50 rounded-2xl px-4 py-3 text-left active:scale-[0.98] transition-all border border-stone-100">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-black uppercase tracking-widest text-stone-400">Gift Message</p>
                <ChevronRight size={14} className={`text-stone-400 transition-transform ${showGiftMsg ? 'rotate-90' : ''}`} />
              </div>
              {showGiftMsg && <p className="text-sm text-stone-600 italic mt-2 leading-relaxed">"{order.giftMessage}"</p>}
            </button>
          )}
        </div>

        {/* Previous attempts */}
        {order.attempts?.length > 0 && (
          <div className="mx-4 mt-3 p-4 bg-red-50 border border-red-100 rounded-2xl space-y-2">
            <p className="text-[9px] font-black uppercase text-red-500 tracking-widest">Previous Attempts ({order.attempts.length})</p>
            {order.attempts.map((a, i) => (
              <div key={i} className="border-t border-red-100 pt-2 first:border-0 first:pt-0">
                <p className="text-xs font-black text-stone-800">{FAILURE_REASON_LABELS[a.reason as FailureReason] || a.reason}</p>
                {a.notes && <p className="text-xs text-stone-500 italic mt-0.5">"{a.notes}"</p>}
                <p className="text-[10px] text-stone-400 mt-0.5">{a.driverName} · {formatDate(a.timestamp)}</p>
              </div>
            ))}
          </div>
        )}

        {/* Admin notes */}
        {isAdmin && (
          <div className="mx-4 mt-3 bg-stone-50 rounded-2xl px-4 py-3 space-y-2">
            <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Admin Notes</p>
            {order.adminNotes && <p className="text-xs text-stone-600 whitespace-pre-line">{order.adminNotes}</p>}
            <div className="flex gap-2">
              <input value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="Add note..." className="flex-1 bg-white border border-stone-200 rounded-xl px-3 py-2.5 text-sm outline-none" />
              <button onClick={handleAddNote} className="px-4 py-2.5 bg-black text-white rounded-xl font-black text-xs uppercase">Add</button>
            </div>
          </div>
        )}

        {/* ── DRIVER ACTIONS ── */}
        {!isCompleted && (
          <div className="mx-4 mt-4 space-y-3">
            <input type="file" accept="image/*" capture="environment" ref={fileRef} onChange={handlePhoto} className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className={`w-full py-5 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-3 active:scale-95 transition-all ${photoData ? 'bg-green-600 text-white' : 'bg-stone-900 text-white'}`}>
              <Camera size={20} />{photoData ? '✓ PHOTO TAKEN — RETAKE' : 'TAKE DELIVERY PHOTO'}
            </button>
            {photoData && <img src={photoData} className="w-full rounded-2xl max-h-48 object-cover" alt="POD" />}
            <button onClick={() => setIsSigning(true)}
              className={`w-full py-5 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-3 active:scale-95 transition-all ${sigData ? 'bg-green-600 text-white' : 'bg-stone-900 text-white'}`}>
              <PenTool size={20} />{sigData ? '✓ SIGNED' : 'GET SIGNATURE'}
            </button>
            <textarea value={driverNote} onChange={e => setDriverNote(e.target.value)} placeholder="Delivery notes..." rows={2}
              className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm font-medium outline-none focus:border-black transition-all resize-none" style={{ minHeight: '100px' }} />
            <button onClick={handleComplete}
              className="w-full py-7 bg-black text-white rounded-2xl font-black uppercase tracking-widest text-lg shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all">
              <CheckCircle2 size={24} /> COMPLETE DELIVERY
            </button>
            <button onClick={() => setShowFailFlow(true)}
              className="w-full py-5 bg-white border-2 border-stone-900 text-stone-900 rounded-2xl font-black uppercase text-sm flex items-center justify-center gap-3 active:scale-95 transition-all">
              <XCircle size={20} /> MARK AS FAILED
            </button>
          </div>
        )}

        {/* Previous attempts */}
        {order.attempts?.length > 0 && (
          <section className="p-5 bg-red-50 border border-red-100 rounded-[28px] space-y-3">
            <p className="text-[9px] font-black uppercase text-red-400 tracking-widest">Previous Attempts ({order.attempts.length})</p>
            {order.attempts.map((a, i) => (
              <div key={i} className="border-t border-red-100 pt-3 first:border-0 first:pt-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-black uppercase text-red-600">Attempt #{a.attemptNumber || i + 1}</span>
                  <span className="text-[10px] font-black text-stone-400">{formatDate(a.timestamp)} {formatTime(a.timestamp)}</span>
                </div>
                <p className="text-xs font-black text-stone-700">{FAILURE_REASON_LABELS[a.reason as FailureReason] || a.reason}</p>
                {a.notes && <p className="text-xs text-stone-500 italic mt-1">"{a.notes}"</p>}
                <p className="text-[10px] text-stone-400 mt-1">Driver: {a.driverName}</p>
              </div>
            ))}
          </section>
        )}

        {/* Admin notes + reassign */}
        {isAdmin && (
          <>
            <section className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Admin Notes</p>
              {order.adminNotes && <div className="bg-stone-50 rounded-xl p-3"><p className="text-xs text-stone-600 leading-relaxed whitespace-pre-line">{order.adminNotes}</p></div>}
              <div className="flex gap-2">
                <input type="text" value={adminNote} onChange={e => setAdminNote(e.target.value)} placeholder="Add note..." className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-black transition-all" />
                <button onClick={handleAddNote} className="px-4 py-3 bg-black text-white rounded-xl font-black text-xs uppercase">Add</button>
              </div>
            </section>
            <section className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Reassign Driver</p>
              <p className="text-xs text-stone-500">Currently: <span className="font-black text-stone-800">{order.driverName || 'Unassigned'}</span></p>
              <div className="flex gap-2">
                <select value={reassignTo} onChange={e => setReassignTo(e.target.value)} className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-medium outline-none">
                  <option value="">Select driver...</option>
                  {allUsers.filter(u => u.role === 'DRIVER' && u.isActive).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <button onClick={handleReassign} disabled={!reassignTo} className="px-4 py-3 bg-black text-white rounded-xl font-black text-xs uppercase disabled:opacity-40">Assign</button>
              </div>
            </section>
            <section className="p-5 bg-stone-50 border border-stone-100 rounded-[28px] space-y-1">
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Delivery Fee</p>
              <p className="text-2xl font-black text-stone-900">${order.deliveryFee.toFixed(2)}</p>
              <p className="text-xs text-stone-400">ZIP {order.address.zip}</p>
            </section>
          </>
        )}

        {/* ── DRIVER ACTIONS ── */}
        {!isCompleted && (
          <section className="space-y-3">
            <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest px-1">Proof of Delivery</p>
            <input type="file" accept="image/*" capture="environment" ref={fileRef} onChange={handlePhoto} className="hidden" />
            <button onClick={() => fileRef.current?.click()}
              className={`w-full py-6 rounded-[28px] font-black uppercase tracking-wider text-sm flex items-center justify-center gap-3 active:scale-95 transition-all shadow-sm ${photoData ? 'bg-green-50 text-green-700 border-2 border-green-200' : 'bg-stone-100 text-stone-700'}`}
            ><Camera size={22} />{photoData ? '✓ PHOTO TAKEN — RETAKE' : 'TAKE PHOTO'}</button>
            {photoData && <img src={photoData} className="w-full rounded-[20px] max-h-48 object-cover border border-stone-100" alt="POD" />}
            <button onClick={() => setIsSigning(true)}
              className={`w-full py-6 rounded-[28px] font-black uppercase tracking-wider text-sm flex items-center justify-center gap-3 active:scale-95 transition-all shadow-sm ${sigData ? 'bg-green-50 text-green-700 border-2 border-green-200' : 'bg-stone-100 text-stone-700'}`}
            ><PenTool size={22} />{sigData ? '✓ SIGNED — REDO' : 'GET SIGNATURE (OPTIONAL)'}</button>
            <textarea value={driverNote} onChange={e => setDriverNote(e.target.value)} placeholder="Delivery notes (optional)..." rows={2}
              className="w-full bg-stone-50 border border-stone-100 rounded-[20px] px-5 py-4 text-sm font-medium outline-none focus:border-black transition-all resize-none" style={{ minHeight: '100px' }} />
            <button onClick={handleComplete}
              className="w-full py-7 bg-green-500 text-white rounded-[32px] font-black uppercase tracking-widest text-base shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all">
              <CheckCircle2 size={24} /> COMPLETE DELIVERY
            </button>
            <button onClick={() => setShowFailFlow(true)}
              className="w-full py-6 bg-white border-2 border-red-300 text-red-500 rounded-[28px] font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 active:scale-95 transition-all">
              <XCircle size={20} /> MARK AS FAILED
            </button>
          </section>
        )}

        {/* ── COMPLETED STATE ── */}
        {isCompleted && (
          <section className="space-y-4">
            <div className={`p-5 rounded-[28px] border space-y-2 ${order.status === DeliveryStatus.DELIVERED ? 'bg-green-50 border-green-200' : order.status === DeliveryStatus.PENDING_RESCHEDULE ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
              <StatusBadge status={order.status} />
              {order.completedAt && <p className="text-xs font-bold text-stone-600">Completed: {formatDate(order.completedAt)} at {formatTime(order.completedAt)}</p>}
              {order.submittedAt && <p className="text-xs font-bold text-stone-500">Submitted: {formatTime(order.submittedAt)}</p>}
              {order.driverNotes && <p className="text-xs italic text-stone-600 mt-1">"{order.driverNotes}"</p>}
            </div>
            {order.confirmationPhoto && <img src={order.confirmationPhoto} className="w-full rounded-[20px] max-h-48 object-cover border border-stone-100" alt="Delivery photo" />}
            {order.confirmationSignature && (
              <div className="bg-white border border-stone-100 rounded-[20px] p-3">
                <p className="text-[9px] font-black uppercase text-stone-400 mb-2">Signature</p>
                <img src={order.confirmationSignature} className="w-full max-h-24 object-contain" alt="Signature" />
              </div>
            )}

            {/* Notification */}
            <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-3">
              <p className="text-[9px] font-black uppercase text-stone-400 tracking-widest">Customer Notification</p>
              {!isWithinSendingHours() && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <Clock size={14} className="text-amber-500" />
                  <p className="text-xs font-black text-amber-700">Sending only allowed 9 AM – 8 PM</p>
                </div>
              )}
              {order.status === DeliveryStatus.DELIVERED && !order.successNotificationSent && (
                <button onClick={() => loadPreview('SUCCESS')}
                  className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                  <Bell size={18} /> Preview & Send Success Message
                </button>
              )}
              {order.status === DeliveryStatus.DELIVERED && order.successNotificationSent && (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl"><Check size={14} className="text-green-600" /><p className="text-xs font-black text-green-700">Success message sent ✓</p></div>
              )}
              {(order.status === DeliveryStatus.FAILED || order.status === DeliveryStatus.PENDING_RESCHEDULE) && !order.failureNotificationSent && (
                <button onClick={() => loadPreview('FAILURE')}
                  className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase text-sm flex items-center justify-center gap-2 active:scale-95 transition-all">
                  <Bell size={18} /> Preview & Send Reschedule Message
                </button>
              )}
              {(order.status === DeliveryStatus.FAILED || order.status === DeliveryStatus.PENDING_RESCHEDULE) && order.failureNotificationSent && (
                <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl"><Check size={14} className="text-green-600" /><p className="text-xs font-black text-green-700">Reschedule message sent with Katie's number ✓</p></div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Modals */}
      {showFailFlow && (
        <FailedDeliveryFlow order={order} currentUser={currentUser} onSubmit={handleFailSubmit} onCancel={() => setShowFailFlow(false)} />
      )}

      {showReschedule && pendingFailure && (
        <RescheduleModal order={order} failureReason={pendingFailure.reason} driverNotes={pendingFailure.notes} photo={pendingFailure.photo} onAutoReschedule={handleAutoReschedule} onManualReschedule={handleManualReschedule} />
      )}

      {showNotifyPreview && (
        <div className="fixed inset-0 bg-black/70 z-[200] flex items-end p-4">
          <div className="w-full bg-white rounded-[36px] p-6 space-y-4 animate-in slide-in-from-bottom">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black uppercase">Preview Message</h3>
              <button onClick={() => setShowNotifyPreview(null)}><X size={22} className="text-stone-400" /></button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase bg-stone-100 px-3 py-1 rounded-full text-stone-600">via {notifyChannel}</span>
            </div>
            <div className="bg-stone-50 rounded-2xl p-4">
              <p className="text-sm text-stone-700 leading-relaxed">{notifyPreviewText}</p>
            </div>
            {notifySent ? (
              <div className="flex items-center justify-center gap-2 py-5 bg-green-50 rounded-[24px]">
                <Check size={20} className="text-green-600" /><span className="font-black text-green-700 uppercase">Message Sent!</span>
              </div>
            ) : (
              <button onClick={handleSend} disabled={isSending || !isWithinSendingHours()}
                className="w-full py-7 bg-green-500 text-white rounded-[32px] font-black uppercase tracking-widest text-xl flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-50 shadow-xl">
                {isSending ? <RefreshCw size={24} className="animate-spin" /> : <Send size={24} />} SEND
              </button>
            )}
          </div>
        </div>
      )}

      {isSigning && <SignaturePad onSave={(sig) => { setSigData(sig); setIsSigning(false); }} onCancel={() => setIsSigning(false)} />}
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
  isSameDayWindow: boolean;
  pendingCount: number;
  inTransitCount: number;
  deliveredTodayCount: number;
  onSelectOrder: (o: Delivery) => void;
}

const OrdersView: React.FC<OrdersViewProps> = ({
  deliveries, isAdmin, currentUser, isSameDayWindow,
  pendingCount, inTransitCount, deliveredTodayCount, onSelectOrder
}) => {
  const today = new Date().toISOString().split('T')[0];
  const [driverDate, setDriverDate] = useState(today);
  const [activeTab, setActiveTab] = useState<'active' | 'done'>('active');
  const [search, setSearch] = useState('');

  const shiftDate = (days: number) => {
    const d = new Date(driverDate + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDriverDate(d.toISOString().split('T')[0]);
  };

  const fmtDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

  // ── ADMIN VIEW ──
  if (isAdmin) {
    const sorted = [...deliveries].sort((a, b) => b.id.localeCompare(a.id)); // newest first
    const filtered = sorted.filter(d => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        d.orderNumber?.toLowerCase().includes(q) ||
        d.customer?.name?.toLowerCase().includes(q) ||
        d.address?.street?.toLowerCase().includes(q) ||
        d.address?.city?.toLowerCase().includes(q) ||
        d.giftReceiverName?.toLowerCase().includes(q)
      );
    });

    const unassignedCount = deliveries.filter(d => !d.driverId || d.status === DeliveryStatus.PENDING).length;

    return (
      <div className="flex flex-col h-full">
        {/* Stats bar */}
        {isSameDayWindow && (
          <div className="mx-0 px-4 py-2 bg-amber-400 flex items-center gap-2">
            <Clock size={13} className="text-amber-900 shrink-0" />
            <p className="text-[11px] font-black text-amber-900 uppercase">Same-day window open — closes at 2:00 PM</p>
          </div>
        )}
        <div className="grid grid-cols-4 border-b border-stone-100">
          {[
            { label: 'Unassigned', val: unassignedCount, color: 'text-red-600' },
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

        {/* Search */}
        <div className="px-4 py-2 border-b border-stone-100">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search order #, customer, address..."
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-black"
          />
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[80px_1fr_100px_90px] bg-stone-50 border-b border-stone-200 px-4 py-2">
          <p className="text-[9px] font-black uppercase text-stone-500">Order #</p>
          <p className="text-[9px] font-black uppercase text-stone-500">Customer / Address</p>
          <p className="text-[9px] font-black uppercase text-stone-500">Driver</p>
          <p className="text-[9px] font-black uppercase text-stone-500 text-right">Status</p>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Package size={32} className="text-stone-200 mb-2" />
              <p className="text-xs font-black uppercase text-stone-300">No orders found</p>
            </div>
          ) : filtered.map((order, idx) => {
            const statusDot: Record<string, string> = {
              PENDING: 'bg-stone-400', ASSIGNED: 'bg-blue-500', IN_TRANSIT: 'bg-black',
              DELIVERED: 'bg-green-500', FAILED: 'bg-red-500',
              SECOND_ATTEMPT: 'bg-stone-700', PENDING_RESCHEDULE: 'bg-amber-500',
            };
            const dot = statusDot[order.status] || 'bg-stone-300';
            const label = STATUS_CONFIG[order.status]?.label || order.status;
            return (
              <div key={order.id} onClick={() => onSelectOrder(order)}
                className={`grid grid-cols-[80px_1fr_100px_90px] px-4 py-3 border-b border-stone-50 cursor-pointer active:bg-stone-50 transition-all ${idx % 2 === 0 ? 'bg-white' : 'bg-stone-50/30'}`}>
                <div>
                  <p className="text-sm font-black text-black">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
                  <p className="text-[9px] text-stone-400">{order.deliveryDate ? fmtDate(order.deliveryDate) : '—'}</p>
                </div>
                <div className="pr-2 min-w-0">
                  <p className="text-sm font-bold text-stone-900 truncate">{order.giftReceiverName || order.customer?.name}</p>
                  <p className="text-[10px] text-stone-400 truncate">{order.address?.street}, {order.address?.city}</p>
                  {order.deliveryInstructions && (
                    <p className="text-[9px] text-amber-700 font-black truncate">⚠ {order.deliveryInstructions}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-bold text-stone-700">{order.driverName || <span className="text-red-500 font-black">Unassigned</span>}</p>
                </div>
                <div className="flex items-start justify-end">
                  <div className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                    <span className="text-[9px] font-black text-stone-600 text-right leading-tight">{label}</span>
                  </div>
                </div>
              </div>
            );
          })}
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
          return (
            <div key={order.id} onClick={() => onSelectOrder(order)}
              className="flex items-center gap-4 px-4 py-4 border-b border-stone-100 cursor-pointer active:bg-stone-50 transition-all">
              <p className="text-xl font-black text-stone-300 w-6 shrink-0">{idx + 1}</p>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-[11px] font-black text-stone-500">#{order.orderNumber?.replace(/^#+/, '') || order.id}</p>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                </div>
                <p className="text-base font-black text-stone-900 leading-tight">{order.giftReceiverName || order.customer?.name}</p>
                <p className="text-sm text-stone-500">{order.address?.street}, {order.address?.city}</p>
                {order.deliveryInstructions && (
                  <p className="text-[10px] font-black text-amber-700 mt-0.5">⚠ {order.deliveryInstructions}</p>
                )}
              </div>
              <ChevronRight size={18} className="text-stone-300 shrink-0" />
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
  onSelectOrder: (order: Delivery) => void;
}> = ({ deliveries, role, currentUserId, onSelectOrder }) => {
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

  const uniqueDrivers = useMemo(() => {
    const seen = new Set<string>(); const list: { id: string; name: string }[] = [];
    deliveries.forEach(d => { if (d.driverId && !seen.has(d.driverId)) { seen.add(d.driverId); list.push({ id: d.driverId, name: d.driverName || d.driverId }); } });
    return list;
  }, [deliveries]);

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="sticky top-0 bg-white z-10 border-b border-stone-100 p-4 space-y-3">
        <div className="flex gap-1.5">
          {(['DAY', 'WEEK', 'MONTH', 'CUSTOM'] as ViewMode[]).map(m => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`flex-1 py-2.5 rounded-xl font-black uppercase text-[10px] transition-all ${viewMode === m ? 'bg-black text-white' : 'bg-stone-100 text-stone-500'}`}
            >{m}</button>
          ))}
        </div>
        {viewMode === 'CUSTOM' ? (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-xs font-black outline-none" />
            <span className="text-stone-400 font-black text-xs">–</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="flex-1 bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 text-xs font-black outline-none" />
          </div>
        ) : (
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-black outline-none text-center" />
        )}
        {isAdmin && uniqueDrivers.length > 0 && (
          <select value={filterDriver} onChange={e => setFilterDriver(e.target.value)} className="w-full bg-stone-50 border border-stone-100 rounded-xl px-4 py-3 text-sm font-medium outline-none">
            <option value="ALL">All Drivers</option>
            {uniqueDrivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex-1 overflow-y-auto pb-24">
        {grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Calendar size={36} className="text-stone-200 mb-3" />
            <p className="text-[11px] font-black uppercase text-stone-300">No deliveries in this range</p>
          </div>
        ) : grouped.map(([date, orders]) => (
          <div key={date}>
            <div className="px-5 py-3 bg-stone-50 border-b border-stone-100 flex items-center justify-between">
              <p className="text-[11px] font-black uppercase text-stone-500 tracking-widest">
                {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <span className="text-[10px] font-black text-stone-400">{orders.length} {orders.length === 1 ? 'stop' : 'stops'}</span>
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
// DRIVER PAY CARD — collapsible per-driver payroll row
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

  useEffect(() => {
    fetch('/api/messages').then(r => r.json()).then(d => { setMessages(d.messages || []); setLoadingMsgs(false); });
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates || []));
  }, []);

  const handleSaveTemplate = async (id: string) => {
    const body = templateEdits[id]; if (!body) return;
    const res = await fetch(`/api/templates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
    const data = await res.json();
    setTemplates(prev => prev.map(t => t.id === id ? data.template : t));
    setEditingTemplate(null);
  };

  return (
    <div className="space-y-4 p-5">
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

  useEffect(() => {
    fetch('/api/templates').then(r => r.json()).then(d => setTemplates(d.templates || []));
  }, []);

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
          // ── compute per-driver payroll ──────────────────────────────────
          const inRange = deliveries.filter(d =>
            d.status === DeliveryStatus.DELIVERED &&
            d.completedAt &&
            d.completedAt.split('T')[0] >= feeStart &&
            d.completedAt.split('T')[0] <= feeEnd
          );

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

          const grandTotal = driverRows.reduce((s, r) => s + r.total, 0);
          const grandCount = driverRows.reduce((s, r) => s + r.count, 0);

          return (
            <div className="space-y-4">

              {/* Date range picker */}
              <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-4">
                <p className="font-black uppercase text-sm text-stone-800 flex items-center gap-2">
                  <FileText size={16} /> Driver Payroll
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">From</label>
                    <input type="date" value={feeStart} onChange={e => setFeeStart(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2.5 text-xs font-black outline-none focus:border-black" />
                  </div>
                  <div>
                    <label className="text-[8px] font-black uppercase text-stone-400 mb-1 block">To</label>
                    <input type="date" value={feeEnd} onChange={e => setFeeEnd(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-100 rounded-xl px-3 py-2.5 text-xs font-black outline-none focus:border-black" />
                  </div>
                </div>

                {/* Quick range buttons */}
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: 'Today', days: 0 },
                    { label: 'Last 7', days: 7 },
                    { label: 'Last 14', days: 14 },
                    { label: 'Last 30', days: 30 },
                  ].map(({ label, days }) => (
                    <button key={label} onClick={() => {
                      const end = new Date();
                      const start = new Date();
                      start.setDate(end.getDate() - days);
                      setFeeEnd(end.toISOString().split('T')[0]);
                      setFeeStart(start.toISOString().split('T')[0]);
                    }}
                      className="px-3 py-2 bg-stone-100 text-stone-600 rounded-xl font-black uppercase text-[9px] active:scale-95 transition-all">
                      {label}
                    </button>
                  ))}
                </div>

                {/* Grand total banner */}
                <div className="flex items-center justify-between p-4 bg-black rounded-2xl">
                  <div>
                    <p className="text-[9px] font-black uppercase text-white/50 mb-0.5">Grand Total</p>
                    <p className="text-[10px] font-black text-white/60">{grandCount} successful {grandCount === 1 ? 'delivery' : 'deliveries'}</p>
                  </div>
                  <span className="text-3xl font-black text-white">${grandTotal.toFixed(2)}</span>
                </div>
              </div>

              {/* Per-driver cards */}
              {driverRows.length === 0 ? (
                <div className="text-center py-12">
                  <FileText size={32} className="mx-auto text-stone-200 mb-2" />
                  <p className="text-[11px] font-black uppercase text-stone-300">No completed deliveries in this range</p>
                </div>
              ) : driverRows.map(row => (
                <DriverPayCard key={row.id} row={row} />
              ))}

              {/* ZIP rate calculator */}
              <div className="p-5 bg-white border border-stone-100 rounded-[28px] shadow-sm space-y-4">
                <p className="font-black uppercase text-sm text-stone-800 flex items-center gap-2">
                  <MapPin size={16} /> Rate by ZIP
                </p>
                <div className="flex gap-2">
                  <input type="text" placeholder="ZIP code" value={feeZip}
                    onChange={e => setFeeZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    className="flex-1 bg-stone-50 border border-stone-100 rounded-2xl px-4 py-4 text-lg font-black outline-none focus:border-black text-center tracking-widest" />
                  <button onClick={() => setFeeResult(DELIVERY_FEES[feeZip] ?? null)}
                    className="px-5 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs active:scale-95">Check</button>
                </div>
                {feeZip.length === 5 && feeResult !== null &&
                  <div className="flex items-center justify-between p-4 bg-green-50 rounded-2xl border border-green-100">
                    <span className="font-black text-stone-700 uppercase text-sm">ZIP {feeZip}</span>
                    <span className="text-2xl font-black text-green-700">${feeResult}</span>
                  </div>}
                {feeZip.length === 5 && feeResult === null &&
                  <p className="text-xs font-black text-red-400 text-center">ZIP not in rate table</p>}
              </div>

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
  const [tab, setTab] = useState<'ORDERS' | 'SCHEDULE' | 'ADMIN'>('ORDERS');
  const isAdmin = currentUser?.role === 'SUPER_ADMIN' || currentUser?.role === 'MANAGER';

  useEffect(() => {
    if (currentUser) {
      fetchOrders();
      fetch('/api/users').then(r => r.json()).then(d => setAllUsers(d.users || []));
      const iv = setInterval(fetchOrders, 300000);
      return () => clearInterval(iv);
    }
  }, [currentUser]);

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const fetched = await getDeliveries();
      // Auto-assign unassigned orders to Katie (default driver)
      const withDefaults = fetched.map((d: Delivery) => {
        if (!d.driverId || d.driverId === '') {
          return { ...d, driverId: 'manager_1', driverName: 'Katie', status: d.status === DeliveryStatus.PENDING ? DeliveryStatus.ASSIGNED : d.status };
        }
        return d;
      });
      setDeliveries(withDefaults);
      setDataSource(withDefaults.some((d: Delivery) => d.id === '33989') ? 'MOCK' : 'LIVE');
      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch { setDataSource('ERROR'); }
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
  const todayOrders = deliveries.filter(d => {
    const dd = (d.deliveryDate || '').split('T')[0];
    return dd === todayStr;
  });
  const pendingCount = deliveries.filter(d => d.status === DeliveryStatus.PENDING || d.status === DeliveryStatus.ASSIGNED).length;
  const inTransitCount = deliveries.filter(d => d.status === DeliveryStatus.IN_TRANSIT).length;
  const deliveredTodayCount = deliveries.filter(d => d.status === DeliveryStatus.DELIVERED && (d.completedAt || '').startsWith(todayStr)).length;

  const now = new Date();
  const isSameDayWindow = now.getHours() < 14; // before 2pm

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
          <span className={`w-2 h-2 rounded-full ${isLoading ? 'bg-amber-400 animate-pulse' : dataSource === 'LIVE' ? 'bg-green-500' : 'bg-red-400'}`} />
          <button onClick={fetchOrders} className={`p-1.5 text-stone-400 ${isLoading ? 'animate-spin' : ''}`}><RefreshCw size={15} /></button>
          <button onClick={logout} className="flex items-center gap-1 px-3 py-2 bg-red-50 text-red-500 rounded-xl font-black uppercase text-[10px] active:scale-95 border border-red-100">
            <LogOut size={13} /> Out
          </button>
        </div>
      </div>

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
            isSameDayWindow={isSameDayWindow}
            pendingCount={pendingCount}
            inTransitCount={inTransitCount}
            deliveredTodayCount={deliveredTodayCount}
            onSelectOrder={setSelectedOrder}
          />
        )}

        {/* ── SCHEDULE TAB ── */}
        {tab === 'SCHEDULE' && (
          <ScheduleView
            deliveries={deliveries}
            role={currentUser.role}
            currentUserId={currentUser.id}
            onSelectOrder={setSelectedOrder}
          />
        )}

        {/* ── ADMIN TAB ── */}
        {tab === 'ADMIN' && isAdmin && (
          <AdminPanel role={currentUser.role} deliveries={deliveries} allUsers={allUsers} setAllUsers={setAllUsers} />
        )}

      </main>
    </div>
  );
}
