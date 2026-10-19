import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { blank, categories, fieldsOf, money, request, totalsByCurrency, type Expense, type Fields, type Health } from './lib';

function Icon({name, size = 20}: {name: string; size?: number}) {
  const paths: Record<string, ReactNode> = {
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    check: <path d="m5 12 4 4L19 6"/>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, leaf: <><path d="M19 4C7 2 2 10 8 16c6 6 14 0 11-12Z"/><path d="m5 21 10-11"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 4h.01"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V5l13-3v3m0 7h5v5h-5z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.receipt}</svg>;
}

function Modal({title, subtitle, children, onClose, wide = false}: {title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    ref.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; before?.focus(); };
  }, []);
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} onCancel={event => {event.preventDefault(); onClose();}} onClick={event => {if (event.target === ref.current) onClose();}} aria-labelledby="modal-title">
    <div className="modal-heading"><div><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close"/></button></div>{children}
  </dialog>;
}

function Editor({expense, onClose, onSaved}: {expense: Expense | null; onClose: () => void; onSaved: (expense: Expense) => void}) {
  const [fields, setFields] = useState<Fields>(expense ? fieldsOf(expense) : {...blank});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const change = (key: keyof Fields, value: unknown) => setFields(current => ({...current, [key]: value}));
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') || 'needs_review';
    try {
      const result = await request<Expense>(expense ? `/expenses/${expense.id}` : '/expenses', {method: expense ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...fields, status: action})});
      onSaved(result);
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  async function remove() {
    setBusy(true); setError('');
    try { await request(`/expenses/${expense!.id}`, {method:'DELETE'}); onClose(); window.dispatchEvent(new Event('expenses-changed')); }
    catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  const input = (label: string, key: keyof Fields, type = 'text', required = false) => <label>{label}<input type={type} value={String(fields[key] ?? '')} onInput={e => {if (type === 'date') change(key, e.currentTarget.value || null);}} onChange={e => change(key, e.target.value || null)} required={required} maxLength={key === 'merchant' ? 160 : undefined} min={type === 'number' ? '0' : undefined} max={type === 'number' ? '100000000' : undefined} step={type === 'number' ? '0.001' : undefined} placeholder={type === 'number' ? 'Not on receipt' : undefined}/></label>;
  return <Modal wide title={expense ? 'Review expense' : 'Add an expense'} subtitle={expense?.filename || 'A little context now. Less paperwork later.'} onClose={() => {if (!busy) onClose();}}>
    <div className={`editor-layout ${expense?.filename ? '' : 'no-preview'}`}>
      {expense?.filename && <aside className="receipt-preview"><div className="preview-label"><Icon name="receipt" size={16}/> Original receipt <a href={`/api/expenses/${expense.id}/receipt`} target="_blank" rel="noreferrer">Open ↗</a></div>{expense.mime === 'application/pdf' ? <iframe title="Original receipt PDF" src={`/api/expenses/${expense.id}/receipt`}/> : <img alt="Original uploaded receipt" src={`/api/expenses/${expense.id}/receipt`}/>}</aside>}
      <form onSubmit={save} className="expense-form">
        {expense && <div className="review-note"><Icon name="shield" size={17}/><span>AI can miss the details. Compare each field with your receipt before verifying.</span></div>}
        {expense && expense.warnings.length > 0 && <div className="warning"><strong>Check these details</strong><ul>{expense.warnings.map(w => <li key={w}>{w}</li>)}</ul><small>These checks refresh when you save.</small></div>}
        <div className="form-grid">{input('Merchant', 'merchant')}{input('Receipt date', 'date', 'date')}
          <label>Currency (ISO code)<input value={fields.currency || ''} placeholder="e.g. USD, EUR, LKR" maxLength={3} onChange={e => change('currency', e.target.value.toUpperCase() || null)}/></label>
          <label>Category<select value={fields.category} onChange={e => change('category', e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
          {input('Subtotal', 'subtotal', 'number')}{input('Tax', 'tax', 'number')}{input('Total amount', 'total', 'number')}
        </div>
        <div className="line-header"><h3>Line items <span>{fields.line_items.length}</span></h3><button className="text-button" type="button" disabled={fields.line_items.length >= 100} onClick={() => change('line_items', [...fields.line_items, {description:'', quantity:null, amount:null}])}><Icon name="plus" size={14}/> Add item</button></div>
        {fields.line_items.map((item, index) => <div className="line-item" key={index}><input aria-label={`Item ${index + 1} description`} placeholder="Description" value={item.description} maxLength={200} required onChange={e => change('line_items', fields.line_items.map((row, i) => i === index ? {...row, description:e.target.value} : row))}/><input aria-label={`Item ${index + 1} quantity`} placeholder="Qty" type="number" min="0.001" step="any" value={item.quantity ?? ''} onChange={e => change('line_items', fields.line_items.map((row, i) => i === index ? {...row, quantity:e.target.value || null} : row))}/><input aria-label={`Item ${index + 1} amount`} placeholder="Amount" type="number" min="0" step="0.001" value={item.amount ?? ''} onChange={e => change('line_items', fields.line_items.map((row, i) => i === index ? {...row, amount:e.target.value || null} : row))}/><button type="button" aria-label={`Remove item ${index + 1}`} className="icon-button" onClick={() => change('line_items', fields.line_items.filter((_, i) => i !== index))}><Icon name="close" size={16}/></button></div>)}
        <label>Notes<textarea maxLength={2000} rows={2} value={fields.notes} placeholder="Project, purpose, or anything worth remembering…" onChange={e => change('notes', e.target.value)}/></label>
        {error && <div role="alert" className="error">{error}</div>}
        {deleting ? <div className="warning">Delete this expense and its original receipt permanently?<div className="button-row"><button type="button" className="button" disabled={busy} onClick={() => setDeleting(false)}>Keep expense</button><button type="button" className="button danger" disabled={busy} onClick={remove}>Delete permanently</button></div></div> : <div className="form-actions">{expense && <button type="button" className="icon-button delete" title="Delete expense" aria-label="Delete expense" disabled={busy} onClick={() => setDeleting(true)}><Icon name="trash"/></button>}<button className="button" value="needs_review" disabled={busy}>Save for review</button><button className="button primary" value="verified" disabled={busy}><Icon name="check" size={17}/>{busy ? 'Saving…' : 'Save & verify'}</button></div>}
      </form>
    </div>
  </Modal>;
}

export default function App() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [currency, setCurrency] = useState('all');
  const [editor, setEditor] = useState<Expense | 'new' | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  async function load() {
    setError(''); setLoading(true);
    try {const [rows, status] = await Promise.all([request<Expense[]>('/expenses'), request<Health>('/health')]); setExpenses(rows); setHealth(status);}
    catch (e) {setError((e as Error).message);} finally {setLoading(false);}
  }
  useEffect(() => {void load(); const reload = () => {void load();}; window.addEventListener('expenses-changed', reload); return () => window.removeEventListener('expenses-changed', reload);}, []);
  useEffect(() => {if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 5000); return () => window.clearTimeout(timer);}, [notice]);
  function selectFile(selected: File | undefined) {
    if (!selected) return;
    setUploadError(''); setFile(null); setConsent(false);
    if (selected.size > 10 * 1024 * 1024) {setUploadError('Choose a receipt smaller than 10 MB.'); return;}
    if (!/\.(jpe?g|png|webp|pdf)$/i.test(selected.name)) {setUploadError('Choose a JPEG, PNG, WebP image or PDF.'); return;}
    setFile(selected); setUploadOpen(true);
  }
  function drop(event: DragEvent) {event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length > 1) {setUploadError('Upload one receipt at a time. A PDF may have up to 5 pages.'); setUploadOpen(true); return;} selectFile(event.dataTransfer.files[0]);}
  async function upload() {
    if (!file || !consent) return;
    setUploading(true); setUploadError('');
    const data = new FormData(); data.append('file', file); data.append('consent', 'true');
    try {const result = await request<Expense>('/receipts/upload', {method:'POST', body:data}); setExpenses(current => [result, ...current]); setUploadOpen(false); setFile(null); setConsent(false); setEditor(result);}
    catch (e) {setUploadError((e as Error).message);} finally {setUploading(false);}
  }
  async function exportCsv() {
    setExporting(true); setError('');
    try {
      const response = await fetch('/api/expenses/export.csv');
      if (!response.ok) throw new Error('Export failed. Please try again.');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'receiptpilot-expenses.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('All expenses exported to CSV.');
    } catch (e) {setError((e as Error).message);} finally {setExporting(false);}
  }
  const reviewCount = expenses.filter(e => e.status === 'needs_review').length;
  const verifiedCount = expenses.length - reviewCount;
  const totals = totalsByCurrency(expenses);
  const currencies = [...new Set(expenses.flatMap(e => e.currency ? [e.currency] : []))].sort();
  const visible = expenses.filter(e => (filter === 'all' || e.status === filter) && (category === 'all' || e.category === category) && (currency === 'all' || e.currency === currency) && `${e.merchant || ''} ${e.notes} ${e.filename || ''}`.toLowerCase().includes(search.toLowerCase()));
  const missingCurrency = expenses.filter(e => !e.currency || e.total === null).length;
  const dateLabel = new Intl.DateTimeFormat(undefined, {month:'long', day:'numeric', year:'numeric'}).format(new Date());
  return <div className="app-shell">
    <aside className="sidebar"><a href="#" className="brand" onClick={e => {e.preventDefault(); setFilter('all');}}><span className="brand-mark"><Icon name="receipt" size={25}/></span>ReceiptPilot<span className="brand-dot">.</span></a><div className="workspace"><span className="workspace-avatar">P</span><div>Personal workspace<small>Your everyday expenses</small></div><span className="workspace-indicator"/></div>
      <div className="nav-label">WORKSPACE</div><nav aria-label="Expense views">{[{id:'all', icon:'grid', name:'All expenses', count:expenses.length}, {id:'needs_review', icon:'clock', name:'Needs review', count:reviewCount}, {id:'verified', icon:'check', name:'Verified', count:verifiedCount}].map(item => <button key={item.id} className={`nav-item ${filter === item.id ? 'active' : ''}`} onClick={() => setFilter(item.id)} aria-current={filter === item.id ? 'page' : undefined}><Icon name={item.icon}/>{item.name}<span>{item.count}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="open-card"><span className="little-icon"><Icon name="leaf" size={18}/></span><h3>Small receipts.<br/>Open possibilities.</h3><p>Powered by open-weight Gemma. Built to keep you in control.</p><button className="text-button" onClick={() => setHelp(true)}>Meet your copilot <Icon name="arrow" size={16}/></button></div><button className="help-button" onClick={() => setHelp(true)}><Icon name="help" size={18}/> Help & privacy <span>↗</span></button><div className="profile"><span>Y</span><div>Your workspace<small>Local · single user</small></div><Icon name="shield" size={17}/></div></div>
    </aside>
    <main><header className="topbar"><div><span className="breadcrumb">Workspace</span><span className="slash">/</span><strong>Expenses</strong></div><div className="topbar-right"><span className={`connection-dot ${health ? '' : 'offline'}`}/>{health ? 'Local workspace' : 'Connecting…'}<button className="icon-button" aria-label="Help and privacy" onClick={() => setHelp(true)}><Icon name="help" size={19}/></button></div></header>
      <div className="page"><div className="page-heading"><div><div className="eyebrow">A LITTLE LESS PAPERWORK</div><h1>Your expenses, in order<span>.</span></h1><p>From a pocket full of receipts to a clearer picture.</p></div><button className="button primary" onClick={() => {setUploadOpen(true); setUploadError('');}}><Icon name="plus" size={18}/> Upload receipt</button></div>
        {error && <div className="error banner" role="alert">{error}<button className="text-button" onClick={() => void load()}>Retry connection</button></div>}
        {health && !health.extraction_configured && <div className="config-banner"><Icon name="shield" size={17}/><span>Ready for your receipts. Connect hosted Gemma in the backend to enable extraction.</span><button className="text-button" onClick={() => setHelp(true)}>Setup details <Icon name="arrow" size={14}/></button></div>}
        <section className="stats" aria-label="Expense summary"><article className="stat total-stat"><div className="stat-label">Total recorded <Icon name="wallet" size={19}/></div><div className={`stat-value ${Object.keys(totals).length > 1 ? 'multi-total' : ''}`}>{Object.keys(totals).length ? Object.entries(totals).map(([code, value]) => <span key={code}>{money(value, code)}</span>) : '—'}</div><div className="stat-foot"><span className="tiny-dot"/>All time · grouped by currency{missingCurrency > 0 && <small>{missingCurrency} incomplete expense{missingCurrency !== 1 ? 's' : ''} excluded</small>}</div></article><article className="stat"><div className="stat-label">Receipts organized <Icon name="receipt" size={19}/></div><div className="stat-value">{expenses.length.toString().padStart(2, '0')}<span className="stat-word">expenses</span></div><div className="stat-foot">One place for every little purchase</div></article><article className="stat"><div className="stat-label">Needs your attention <Icon name="clock" size={19}/></div><div className="stat-value">{reviewCount.toString().padStart(2, '0')}<span className={`status-pill ${reviewCount ? 'review' : 'verified'}`}>{reviewCount ? 'To review' : 'All clear'}</span></div><button className="stat-foot text-button" onClick={() => setFilter('needs_review')}>Check extracted details <Icon name="arrow" size={15}/></button></article></section>
        <section className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={e => {e.preventDefault(); setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={drop}><div className="upload-art"><Icon name="receipt" size={35}/><span><Icon name="plus" size={13}/></span></div><div className="upload-copy"><h2>Drop the receipt. Keep the clarity.</h2><p>Drag a receipt here, or <button className="inline-link" onClick={() => fileInput.current?.click()}>browse files</button> to get started.</p><small>JPG, PNG, WebP or PDF · up to 10 MB · 5 pages per PDF</small></div><div className="gemma-tag"><span>✧</span> UNDERSTOOD BY GEMMA</div></section>
        <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => {selectFile(e.target.files?.[0]); e.target.value = '';}}/>
        {uploadError && !uploadOpen && <div className="error" role="alert">{uploadError}</div>}
        <section className="expenses-section"><div className="section-heading"><div><h2>{filter === 'all' ? 'All expenses' : filter === 'needs_review' ? 'Needs review' : 'Verified expenses'} <span className="count-tag">{visible.length}</span></h2><p>The details that keep your business moving.</p></div><div className="button-row"><button className="button" onClick={() => setEditor('new')}><Icon name="plus" size={16}/> Add manually</button><button className="button" disabled={!expenses.length || exporting} onClick={() => void exportCsv()}><Icon name="download" size={16}/>{exporting ? 'Exporting…' : 'Export all CSV'}</button></div></div>
          <div className="table-card"><div className="table-tools"><label className="search"><Icon name="search" size={18}/><input aria-label="Search expenses" placeholder="Search merchant, notes, or file…" value={search} onChange={e => setSearch(e.target.value)}/></label><div className="filters"><select aria-label="Filter category" value={category} onChange={e => setCategory(e.target.value)}><option value="all">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select><select aria-label="Filter currency" value={currency} onChange={e => setCurrency(e.target.value)}><option value="all">All currencies</option>{currencies.map(c => <option key={c}>{c}</option>)}</select></div></div>
            <div className="table-scroll"><table><thead><tr><th>MERCHANT</th><th>DATE</th><th>CATEGORY</th><th>STATUS</th><th className="amount">AMOUNT</th><th aria-label="Actions"/></tr></thead><tbody>{visible.map(e => <tr key={e.id}><td><button className="merchant-button" onClick={() => setEditor(e)}><span className={`merchant-icon cat-${categories.indexOf(e.category)}`}><Icon name={e.category === 'Software' ? 'grid' : e.category === 'Travel' ? 'arrow' : 'receipt'} size={19}/></span><span><strong>{e.merchant || 'Unknown merchant'}</strong><small>{e.filename || 'Manual entry'}</small></span></button></td><td>{e.date ? new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric', year:'numeric'}).format(new Date(`${e.date}T12:00:00`)) : 'Missing date'}</td><td><span className="category-pill">{e.category}</span></td><td><span className={`status-pill ${e.status === 'verified' ? 'verified' : 'review'}`}><Icon name={e.status === 'verified' ? 'check' : 'clock'} size={12}/>{e.status === 'verified' ? 'Verified' : 'Needs review'}</span></td><td className="amount"><strong>{money(e.total, e.currency)}</strong></td><td><button className="icon-button" aria-label={`Review ${e.merchant || 'expense'}`} onClick={() => setEditor(e)}><Icon name="arrow" size={17}/></button></td></tr>)}</tbody></table></div>
            {!visible.length && <div className="empty-state"><span className="empty-icon"><Icon name={search || category !== 'all' || currency !== 'all' ? 'search' : 'receipt'} size={30}/></span><h3>{loading ? 'Getting your workspace ready…' : expenses.length ? 'A clean slate for this view' : 'Your next receipt belongs here'}</h3><p>{loading ? 'Connecting to your local expense organizer.' : expenses.length ? 'Try a different search or filter to find your expense.' : 'Upload your first receipt and let Gemma handle the details.'}</p>{!loading && <button className="text-button" onClick={() => {if (expenses.length) {setSearch(''); setCategory('all'); setCurrency('all'); setFilter('all');} else {setUploadOpen(true); setUploadError('');}}}>{expenses.length ? 'Clear all filters' : 'Upload a receipt'}<Icon name="arrow" size={16}/></button>}</div>}
            <div className="table-footer"><span>{visible.length} of {expenses.length} expenses</span><span><Icon name="shield" size={13}/> You review. You’re in control.</span></div>
          </div>
        </section><footer className="page-footer"><span><Icon name="leaf" size={15}/> Built on open innovation. Made for your everyday.</span><span>{dateLabel}</span></footer>
      </div>
    </main>
    {notice && <div className="toast" role="status"><Icon name="check" size={18}/>{notice}</div>}
    {editor && <Editor key={editor === 'new' ? 'new' : editor.id} expense={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={saved => {setExpenses(current => [saved, ...current.filter(e => e.id !== saved.id)]); setEditor(null); setNotice(saved.status === 'verified' ? 'Expense saved and verified.' : 'Expense saved for review.');}}/>}
    {uploadOpen && <Modal title="A receipt, ready for takeoff." subtitle="Upload one receipt. We’ll help with the details." onClose={() => {if (!uploading) setUploadOpen(false);}}><div className="upload-dialog"><button className="file-picker" disabled={uploading} onClick={() => fileInput.current?.click()}><Icon name="upload" size={28}/><strong>{file ? file.name : 'Choose a receipt'}</strong><span>{file ? `${(file.size / 1024).toFixed(0)} KB · Click to change` : 'JPG, PNG, WebP or PDF · up to 10 MB'}</span></button><div className="privacy-note"><Icon name="shield" size={20}/><p>Receipt images are sent to <strong>Google’s hosted Gemma</strong> for extraction. Your original and saved expenses stay in this local workspace. Hosted inference is not offline or fully private.</p></div><label className="consent"><input type="checkbox" checked={consent} disabled={uploading} onChange={e => setConsent(e.target.checked)}/><span>I agree to send this receipt to Google. I’ve checked it for sensitive information.</span></label>{health && !health.extraction_configured && <div className="warning">Extraction needs a server API key. See Help & privacy for setup, or add your expense manually.</div>}{uploadError && <div className="error" role="alert">{uploadError}</div>}{uploading && <div className="processing" role="status"><span className="spinner"/> Gemma is reading your receipt. This can take up to 90 seconds.</div>}<div className="button-row upload-actions"><button className="button" disabled={uploading} onClick={() => {setUploadOpen(false); setEditor('new');}}>Enter manually</button><button className="button primary" disabled={!file || !consent || uploading || !health?.extraction_configured} onClick={() => void upload()}><Icon name="leaf" size={16}/>{uploading ? 'Understanding…' : 'Extract with Gemma'}</button></div></div></Modal>}
    {help && <Modal title="Your receipts. A clearer process." subtitle="A small organizer, with open-weight AI at its core." onClose={() => setHelp(false)}><div className="help-content"><h3>1. Connect hosted Gemma</h3><p>In <code>backend/.env</code>, set <code>GEMMA_API_KEY</code> using your own Google AI Studio API key. Restart the backend. The default model is <code>gemma-4-31b-it</code>; change <code>GEMMA_MODEL</code> if your account uses another vision-capable Gemma model.</p><h3>2. Upload, check, organize</h3><p>Upload a clear receipt image or a PDF with up to 5 pages. Compare the extracted fields with the original, correct anything missing, then save and verify. You can always enter expenses manually.</p><h3>3. Take your data with you</h3><p>CSV export includes all saved expenses, with their currency and review status. Totals never combine different currencies. Delete an expense to remove its original from this workspace.</p><h3>Privacy, in plain language</h3><p>Your files and expenses are stored on the backend’s disk. Extraction sends resized receipt images to Google. Unpaid API services may use submitted content to improve products and may involve human review; do not send sensitive or confidential receipts through unpaid services. Paid service policies differ. Deleting here does not delete any provider logs.</p><p>This version is for one person on their own computer. It has no sign-in or cloud synchronization. Read the README before deploying it beyond your device.</p><a className="text-button" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Read Google’s data terms ↗</a><div className="model-label"><span className={`connection-dot ${health?.extraction_configured ? '' : 'offline'}`}/>{health?.extraction_configured ? 'Hosted extraction configured' : 'Hosted extraction not configured'} · {health?.model || 'Gemma'}</div></div></Modal>}
  </div>;
}
