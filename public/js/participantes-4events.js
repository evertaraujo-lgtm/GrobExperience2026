import {getAuthServices, getFirestoreServices, getFunctionsServices} from "/js/firebase-client.js";

const list = document.querySelector("[data-list]"); const total = document.querySelector("[data-total]"); const feedback = document.querySelector("[data-feedback]"); const search = document.querySelector("[data-search]"); const alphabet = document.querySelector("[data-alphabet]"); const latestRegistrationsToggle = document.querySelector("[data-latest-registrations]");
const importModal = document.querySelector("[data-import-modal]"); const importForm = document.querySelector("[data-import-form]"); const importSubmit = document.querySelector("[data-import-submit]"); const importFeedback = document.querySelector("[data-import-feedback]");
const columnsModal = document.querySelector("[data-columns-modal]"); const columnsForm = document.querySelector("[data-columns-form]"); const columnOptions = document.querySelector("[data-column-options]"); const loadMoreButton = document.querySelector("[data-load-more]");
const complementImportModal = document.querySelector("[data-complement-import-modal]"); const complementImportForm = document.querySelector("[data-complement-import-form]"); const complementImportFile = document.querySelector("[data-complement-import-file]"); const complementImportFileName = document.querySelector("[data-complement-import-file-name]"); const complementImportSubmit = document.querySelector("[data-complement-import-submit]"); const complementImportFeedback = document.querySelector("[data-complement-import-feedback]");
const adminOnlyElements = document.querySelectorAll("[data-admin-only]");

const requestedColumns = [
  ["idParticipante", "ID participante", ["id4Events", "id", "certificate_id", "certificateId", "attendee_id", "attendeeId", "participant_id", "participantId"]],
  ["qrCode", "QRCODE", ["qrCode", "qrcode", "qr_code", "attendee_qrcode", "attendee_qr_code"]],
  ["nome", "Nome", ["nome", "name", "full_name", "attendee_name", "attendee_full_name", "participant_name"]],
  ["cpf", "CPF", ["cpf", "attendee_doc", "document", "document_number", "tax_id"]],
  ["email", "E-mail", ["email", "attendee_email", "attendeeEmail", "participant_email"]],
  ["estrangeiro", "Estrangeiro", ["estrangeiro", "foreign", "is_foreign", "international"]],
  ["whatsapp", "Celular (WhatsApp)", ["whatsapp", "phone", "cellphone", "mobile", "attendee_phone", "attendee_whatsapp"]],
  ["whatsappCompleto", "Celular (WhatsApp) - adicione o DDI (+055), o código de área local (DDD) e o número do celular", ["whatsapp_completo", "whatsapp_complete", "phone_with_country_code", "cellphone_with_country_code", "mobile_with_country_code"]],
  ["pais", "País", ["pais", "country"]], ["estado", "Estado", ["estado", "state", "province"]], ["cidade", "Cidade", ["cidade", "city"]], ["endereco", "Endereço", ["endereco", "address"]],
  ["empresa", "Empresa", ["empresa", "company", "organization", "attendee_company", "participant_company"]], ["cargo", "Cargo", ["cargo", "job_title", "position", "role"]], ["nivel", "Nível", ["nivel", "level"]], ["setorIndustrial", "Setor Industrial", ["setorIndustrial", "setor_industrial", "industrial_sector", "industry", "sector"]],
  ["dataParticipacao", "Data de participação", ["dataParticipacao", "date", "event_date", "attendee_date", "eventDate", "participation_date"]],
  ["necessidadeAcessibilidade", "Você possui alguma necessidade de acessibilidade ou recurso especial para participar do evento?", ["necessidade_acessibilidade", "accessibility_need", "accessibility", "special_needs"]],
  ["recursoAcessibilidade", "Qual recurso você necessita? (marque um ou mais)", ["recurso_acessibilidade", "accessibility_resource", "accessibility_resources", "special_resource"]],
  ["dataParticipacaoEvento", "Data de participação no evento", ["data_participacao_evento", "event_participation_date", "participation_date_event"]],
  ["presente", "Presente", ["presente", "attendee_attending_event", "attending", "present"]], ["status", "Status", ["status", "attendee_status"]], ["categoria", "Categoria", ["attendeeCat", "attendee_cat", "category", "categoria"]],
  ["atividadesEscolhidas", "Atividades Escolhidas", ["atividades_escolhidas", "selected_activities", "activities"]], ["dataInscricao", "Data de inscrição", ["data_inscricao", "registration_date", "registered_at", "created_at"]], ["dataPagamento", "Data de Pagamento da Inscrição", ["data_pagamento_inscricao", "payment_date", "paid_at"]],
  ["cupom", "Cupom", ["cupom", "coupon", "coupon_code"]], ["primeiroAcesso", "Primeiro acesso", ["primeiro_acesso", "first_access", "first_login"]], ["ultimoAcesso", "Último acesso", ["ultimo_acesso", "last_access", "last_login"]], ["comentarios", "Comentários", ["comentarios", "comments", "notes"]],
  ["celularParticipante", "Celular do participante", ["celular_participante", "participant_cellphone", "participant_phone"]], ["passaporte", "Número do Passaporte", ["numero_passaporte", "passport_number", "passport"]], ["origem", "Origem", ["origem", "source"]], ["revendedor", "Revendedor", ["revendedor", "reseller"]],
  ["empresa2", "Empresa2", ["empresa2", "company2"]], ["cargo3", "Cargo3", ["cargo3", "position3", "job_title3"]], ["lote", "Lote", ["lote", "batch", "lot"]], ["empenho", "Empenho", ["empenho", "commitment"]], ["paganteNome", "Pagante (nome)", ["pagante_nome", "payer_name", "payer"]], ["paganteEmail", "Pagante (email)", ["pagante_email", "payer_email"]], ["assentoReservado", "Assento Reservado", ["assento_reservado", "reserved_seat", "seat"]],
];
const columnsByKey = new Map(requestedColumns.map(([key, label, aliases]) => [key, {label, aliases}]));
const columnLabels = Object.fromEntries(requestedColumns.map(([key, label]) => [key, label]));
const columnsStorageKey = "grob-4events-columns-v2";
const defaultColumns = requestedColumns.map(([key]) => key);
const initials = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const requestedInitial = new URL(window.location.href).searchParams.get("inicial")?.toUpperCase() || "";
let selectedInitial = /^[A-Z]$/.test(requestedInitial) ? requestedInitial : "";
let participants = []; let totalParticipants = 0; let filteredParticipants = 0; let latestRegistrationsOnly = false; let visibleColumns = JSON.parse(localStorage.getItem(columnsStorageKey) || "null") || defaultColumns; let nextParticipantCursor = null; let canManage = false; let listParticipantsApi; let xlsxModulePromise; let loadRequestId = 0; let searchTimer; const pageSize = 200;
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {dateStyle:"short", timeStyle:"short", timeZone:"America/Sao_Paulo"});
const normalize = (item) => String(item ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const complementHeaderAliases = {
  idParticipante: ["id participante", "id do participante", "attendee id", "participant id", "id"],
  qrCode: ["qrcode", "qr code", "codigo qr", "attendee qrcode"],
  email: ["e mail", "email", "attendee email"],
  cpf: ["cpf", "documento", "attendee doc"],
  pais: ["pais", "country"],
  estado: ["estado", "uf", "state", "province"],
  cidade: ["cidade", "municipio", "city"],
  endereco: ["endereco", "endereco completo", "address"],
  logradouro: ["logradouro", "rua", "avenida"],
  numero: ["numero", "numero endereco"],
  complemento: ["complemento", "complemento endereco"],
  bairro: ["bairro", "district"],
  cep: ["cep", "codigo postal", "zip code"],
  empresa: ["empresa", "company", "organization"],
  cargo: ["cargo", "position", "job title", "funcao"],
  nivel: ["nivel", "nivel hierarquico", "level"],
  setorIndustrial: ["setor industrial", "industrial sector", "industry", "sector"],
};
const complementIdentityFields = ["idParticipante", "qrCode", "email", "cpf"];
const complementDataFields = ["pais", "estado", "cidade", "endereco", "empresa", "cargo", "nivel", "setorIndustrial"];
const sourceData = (participant) => participant.dados4Events && typeof participant.dados4Events === "object" ? participant.dados4Events : {};
const rawValue = (participant, aliases) => { const source = sourceData(participant); for (const key of aliases) { const item = participant[key] ?? source[key]; if (item !== undefined && item !== null && item !== "") return item; } return undefined; };
function displayValue(item) { if (item?.toDate) return item.toDate().toLocaleString("pt-BR"); if (Array.isArray(item)) return item.map(displayValue).filter(Boolean).join(", "); if (typeof item === "object" && item !== null) return Object.values(item).map(displayValue).filter(Boolean).join(", "); return String(item ?? ""); }
function formatUnixDate(item) { const raw=String(item??"").trim(); if(!/^\d{10}(?:\d{3})?$/.test(raw))return null; const timestamp=Number(raw); const date=new Date(raw.length===10?timestamp*1000:timestamp); if(Number.isNaN(date.getTime()))return null; return dateTimeFormatter.format(date).replace(", "," às "); }
function value(participant, key) { const column = columnsByKey.get(key); let item = column ? rawValue(participant, column.aliases) : participant[key]; if (key === "whatsappCompleto" && !item) { const phone = String(rawValue(participant, columnsByKey.get("whatsapp").aliases) || "").replace(/\D/g, ""); item = phone ? `+${phone.startsWith("55") ? phone : `55${phone}`}` : ""; } if (key === "presente" && (item === true || item === "1" || item === 1)) return "Presente"; if (key === "presente" && (item === false || item === "0" || item === 0)) return "Não presente"; if(key==="dataInscricao")return formatUnixDate(item)||displayValue(item)||"Não informado"; return displayValue(item) || "Não informado"; }
const searchableText = (participant) => displayValue({...participant, ...sourceData(participant)});
function setFeedback(message, state="neutral") { feedback.textContent=message; feedback.dataset.state=state; }
function normalizedHeader(item) { return normalize(item).replace(/[^a-z0-9]+/g," ").trim(); }
function spreadsheetValue(row, aliases) { for(const alias of aliases){const item=row[alias];if(item!==undefined&&item!==null&&String(item).trim())return String(item).trim();}return ""; }
function getXlsxModule() { if(!xlsxModulePromise)xlsxModulePromise=import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm"); return xlsxModulePromise; }
function spreadsheetComplementRows(XLSX, workbook) {
  const identityHeaders=new Set(complementIdentityFields.flatMap((field)=>complementHeaderAliases[field]));
  const dataHeaders=new Set(Object.entries(complementHeaderAliases).filter(([field])=>!complementIdentityFields.includes(field)).flatMap(([,aliases])=>aliases));
  for(const sheetName of workbook.SheetNames){
    const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[sheetName],{header:1,defval:"",raw:true});
    const headerIndex=matrix.findIndex((row)=>{const headers=row.map(normalizedHeader);return headers.some((header)=>identityHeaders.has(header))&&headers.some((header)=>dataHeaders.has(header));});
    if(headerIndex===-1)continue;
    const headers=matrix[headerIndex].map(normalizedHeader);
    const rows=matrix.slice(headerIndex+1).map((values,index)=>({line:headerIndex+index+2,values:Object.fromEntries(headers.map((header,column)=>[header,values[column]??""]))})).filter((row)=>Object.values(row.values).some((item)=>String(item).trim()));
    return {sheetName,rows};
  }
  throw new Error("Não encontrei uma aba com identificador e dados complementares. Use ID participante, QRCODE, E-mail ou CPF para correlacionar.");
}
function normalizeComplementRow(row) {
  const result={};
  Object.entries(complementHeaderAliases).forEach(([field,aliases])=>{result[field]=spreadsheetValue(row.values,aliases);});
  result.email=result.email.toLowerCase(); result.cpf=result.cpf.replace(/\D/g,""); if(result.cpf&&result.cpf.length<11)result.cpf=result.cpf.padStart(11,"0");
  if(result.email&&!/^\S+@\S+\.\S+$/.test(result.email))return null;
  if(!result.endereco)result.endereco=[result.logradouro,result.numero,result.complemento,result.bairro,result.cep].filter(Boolean).join(", ");
  const complement=Object.fromEntries([...complementIdentityFields,...complementDataFields].map((field)=>[field,result[field]||""]));
  const hasIdentity=complementIdentityFields.some((field)=>complement[field]); const hasData=complementDataFields.some((field)=>complement[field]);
  return hasIdentity&&hasData?complement:null;
}
function complementKey(item) { if(item.idParticipante)return `id:${normalize(item.idParticipante).trim()}`; if(item.qrCode)return `qr:${normalize(item.qrCode).trim()}`; if(item.email)return `email:${item.email}`; return `cpf:${item.cpf}`; }
function renderAlphabet() { alphabet.replaceChildren(); [["", "Todos"], ...initials.map((initial)=>[initial, initial])].forEach(([initial, label])=>{ const button=document.createElement("button"); button.type="button"; button.textContent=label; button.dataset.initial=initial; button.setAttribute("aria-pressed",String(initial===selectedInitial)); button.addEventListener("click",async()=>{ if(initial===selectedInitial)return; selectedInitial=initial; const url=new URL(window.location.href); if(initial)url.searchParams.set("inicial",initial);else url.searchParams.delete("inicial"); window.history.replaceState({},"",url); renderAlphabet(); await load(); }); alphabet.append(button); }); }
function render() { const term=normalize(search.value).trim(); const scope=!term&&selectedInitial&&!latestRegistrationsOnly?` na letra ${selectedInitial}`:""; const scopeTotal=latestRegistrationsOnly||selectedInitial?filteredParticipants:totalParticipants; const modeLabel=latestRegistrationsOnly?" inscrito(s) por data de inscrição":" participante(s)"; total.textContent=term?`${participants.length} resultado(s) carregado(s) ${latestRegistrationsOnly?"nos últimos inscritos":"em toda a lista"} · ${totalParticipants} participante(s) no total`:`${participants.length} de ${scopeTotal}${modeLabel}${scope} · ${totalParticipants} no total`; list.replaceChildren(); if (!participants.length) { list.innerHTML=`<p class="empty-state">${term?"Nenhum participante encontrado.":latestRegistrationsOnly?"Nenhum participante com data de inscrição foi encontrado.":`Nenhum participante encontrado${selectedInitial?` com a inicial ${selectedInitial}`:""}.`}</p>`; return; } participants.forEach((participant)=>{ const row=document.createElement("article"); row.className="four-events-participant-row"; visibleColumns.forEach((key)=>{ const field=document.createElement("div"); field.className="participant-meta"; const strong=document.createElement("strong"); strong.textContent=value(participant,key); const label=document.createElement("span"); label.textContent=columnLabels[key] || key; field.append(strong,label); row.append(field); }); list.append(row); }); }
async function fetchParticipantsPage(afterId=null,includeTotal=false,initial=selectedInitial,searchTerm="",sortMode="") { if(!listParticipantsApi){const {functions,functionsModule}=await getFunctionsServices();listParticipantsApi=functionsModule.httpsCallable(functions,"list4EventsParticipants");} const result=await listParticipantsApi({pageSize,afterId,includeTotal,initial,searchTerm,sortMode}); return {participants:Array.isArray(result.data.participants)?result.data.participants:[],nextCursor:typeof result.data.nextCursor==="string"?result.data.nextCursor:null,total:Number.isInteger(result.data.total)?result.data.total:null,filteredTotal:Number.isInteger(result.data.filteredTotal)?result.data.filteredTotal:null}; }
async function load(more=false) { const requestId=++loadRequestId; const term=normalize(search.value).trim(); const recentMode=latestRegistrationsOnly; const initial=term||recentMode?"":selectedInitial; const sortMode=recentMode?"registrationDateDesc":""; if(!more){participants=[];filteredParticipants=0;nextParticipantCursor=null;loadMoreButton.hidden=true;list.innerHTML=`<p class="empty-state">${term?"Buscando participantes...":recentMode?"Carregando últimos inscritos...":"Carregando participantes..."}</p>`;} total.textContent=more ? (term?"Buscando mais resultados...":recentMode?"Carregando mais inscritos...":`Carregando mais${initial?` da letra ${initial}`:""}...`) : (term?"Buscando participantes...":recentMode?"Carregando últimos inscritos...":`Carregando${initial?` letra ${initial}`:""}...`); try { const page=await fetchParticipantsPage(more?nextParticipantCursor:null,!more,initial,term,sortMode); if(requestId!==loadRequestId||term!==normalize(search.value).trim()||recentMode!==latestRegistrationsOnly||(!term&&!recentMode&&initial!==selectedInitial))return; participants=more?[...participants,...page.participants]:page.participants; if(page.total!==null)totalParticipants=page.total; if(page.filteredTotal!==null)filteredParticipants=page.filteredTotal; nextParticipantCursor=page.nextCursor; loadMoreButton.hidden=!nextParticipantCursor; loadMoreButton.textContent=term?"Carregar mais resultados":recentMode?"Carregar mais inscritos":selectedInitial?`Carregar mais da letra ${selectedInitial}`:"Carregar mais"; setFeedback(""); render(); } catch(error) { if(requestId!==loadRequestId)return; console.error(error); total.textContent=totalParticipants?`${totalParticipants} participante(s) no total`:"Não foi possível carregar"; list.replaceChildren(); setFeedback(error.message||"Não foi possível carregar os participantes da 4 Events.","error"); } }
function renderColumnOptions() { columnOptions.replaceChildren(); requestedColumns.forEach(([key, label])=>{ const option=document.createElement("label"); const input=document.createElement("input"); input.type="checkbox"; input.value=key; input.checked=visibleColumns.includes(key); option.append(input,label); columnOptions.append(option); }); }
document.querySelector("[data-import]").addEventListener("click",()=>{ if(!canManage)return; importForm.reset(); importFeedback.textContent=""; importModal.showModal(); }); document.querySelectorAll("[data-import-cancel]").forEach((button)=>button.addEventListener("click",()=>importModal.close()));
importForm.addEventListener("submit",async(event)=>{ event.preventDefault(); if(!canManage||!importForm.reportValidity())return; importSubmit.disabled=true; importSubmit.textContent="Importando..."; try { const {functions,functionsModule}=await getFunctionsServices(); const result=await functionsModule.httpsCallable(functions,"sync4EventsParticipants")({eid:new FormData(importForm).get("eid")}); importFeedback.textContent=`${result.data.imported} participante(s) importado(s) ou atualizado(s) para o EID ${result.data.eid}.`; importFeedback.dataset.state="success"; await load(); } catch(error) { console.error(error); importFeedback.textContent=error.message||"Não foi possível importar os participantes."; importFeedback.dataset.state="error"; } finally { importSubmit.disabled=false; importSubmit.textContent="Importar participantes"; } });
document.querySelector("[data-complement-import]").addEventListener("click",()=>{if(!canManage)return;complementImportForm.reset();complementImportFileName.textContent="Nenhuma planilha selecionada.";complementImportFeedback.textContent="";complementImportModal.showModal();});
document.querySelectorAll("[data-complement-import-cancel]").forEach((button)=>button.addEventListener("click",()=>complementImportModal.close()));
complementImportFile.addEventListener("change",()=>{complementImportFileName.textContent=complementImportFile.files[0]?.name||"Nenhuma planilha selecionada.";});
complementImportForm.addEventListener("submit",async(event)=>{
  event.preventDefault(); if(!canManage||!complementImportForm.reportValidity())return; const file=complementImportFile.files[0]; if(!file)return;
  if(file.size>10*1024*1024){complementImportFeedback.textContent="A planilha deve ter no máximo 10 MB.";complementImportFeedback.dataset.state="error";return;}
  complementImportSubmit.disabled=true; complementImportSubmit.textContent="Lendo planilha..."; complementImportFeedback.textContent="";
  try{
    const XLSX=await getXlsxModule(); const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"}); const parsed=spreadsheetComplementRows(XLSX,workbook);
    const unique=new Map(); const invalid=[];
    parsed.rows.forEach((row)=>{const item=normalizeComplementRow(row);if(item)unique.set(complementKey(item),item);else invalid.push(row.line);});
    const rows=[...unique.values()]; if(!rows.length)throw new Error("Nenhuma linha válida foi encontrada na planilha.");
    const {functions,functionsModule}=await getFunctionsServices(); const importApi=functionsModule.httpsCallable(functions,"import4EventsParticipantComplements");
    const importacaoId=crypto.randomUUID(); let created=0; let updated=0;
    for(let index=0;index<rows.length;index+=350){
      const chunk=rows.slice(index,index+350); complementImportSubmit.textContent=`Importando ${Math.min(index+chunk.length,rows.length)} de ${rows.length}...`;
      const result=await importApi({complementos:chunk,importacaoId,arquivoOrigem:file.name}); created+=Number(result.data.created||0); updated+=Number(result.data.updated||0);
    }
    complementImportModal.close(); const invalidMessage=invalid.length?` ${invalid.length} linha(s) inválida(s) foram ignoradas: ${invalid.slice(0,10).join(", ")}${invalid.length>10?"…":""}.`:"";
    const successMessage=`Planilha ${parsed.sheetName}: ${created} registro(s) criado(s) e ${updated} atualizado(s).${invalidMessage}`; await load(); setFeedback(successMessage,"success");
  }catch(error){console.error(error);complementImportFeedback.textContent=error.message||"Não foi possível importar a planilha complementar.";complementImportFeedback.dataset.state="error";}
  finally{complementImportSubmit.disabled=false;complementImportSubmit.textContent="Importar complementos";}
});
document.querySelector("[data-columns]").addEventListener("click",()=>{ renderColumnOptions(); columnsModal.showModal(); }); document.querySelectorAll("[data-columns-cancel]").forEach((button)=>button.addEventListener("click",()=>columnsModal.close()));
document.querySelector("[data-columns-select-all]").addEventListener("click",()=>columnOptions.querySelectorAll("input").forEach((input)=>{input.checked=true;})); document.querySelector("[data-columns-clear-all]").addEventListener("click",()=>columnOptions.querySelectorAll("input").forEach((input)=>{input.checked=false;}));
columnsForm.addEventListener("submit",(event)=>{ event.preventDefault(); const selected=[...columnOptions.querySelectorAll("input:checked")].map((input)=>input.value); if(!selected.length){ window.alert("Selecione pelo menos uma coluna."); return; } visibleColumns=selected; localStorage.setItem(columnsStorageKey,JSON.stringify(visibleColumns)); columnsModal.close(); render(); });
document.querySelector("[data-export]").addEventListener("click",async()=>{ const button=document.querySelector("[data-export]"); button.disabled=true; button.textContent="Exportando..."; try { const rows=[]; let cursor=null; do { const page=await fetchParticipantsPage(cursor,false,""); rows.push(...page.participants); cursor=page.nextCursor; } while(cursor); const escape=(item)=>`"${String(item??"").replaceAll('"','""')}"`; const csv=[defaultColumns.map((key)=>escape(columnLabels[key])).join(";"),...rows.map((participant)=>defaultColumns.map((key)=>escape(value(participant,key))).join(";"))].join("\r\n"); const url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"})); const link=document.createElement("a"); link.href=url; link.download="participantes-4events.csv"; link.click(); URL.revokeObjectURL(url); setFeedback(`${rows.length} participante(s) exportado(s) com as colunas da 4 Events.`,"success"); } catch(error) { console.error(error); setFeedback(error.message||"Não foi possível exportar os participantes.","error"); } finally { button.disabled=false; button.textContent="Exportar CSV"; } });
search.addEventListener("input",()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(),300);}); latestRegistrationsToggle.addEventListener("click",async()=>{latestRegistrationsOnly=!latestRegistrationsOnly;latestRegistrationsToggle.textContent=latestRegistrationsOnly?"Todos os participantes":"Últimos inscritos";latestRegistrationsToggle.setAttribute("aria-pressed",String(latestRegistrationsOnly));alphabet.hidden=latestRegistrationsOnly;await load();}); document.querySelector("[data-reload]").addEventListener("click",()=>load()); loadMoreButton.addEventListener("click",async()=>{loadMoreButton.disabled=true;await load(true);loadMoreButton.disabled=false;}); renderAlphabet();
const {auth,authModule}=await getAuthServices(); authModule.onAuthStateChanged(auth,async(user)=>{ if(!user)return; const {db,firestoreModule:firestore}=await getFirestoreServices(); const profile=await firestore.getDoc(firestore.doc(db,"users",user.uid)); if(profile.exists()&&profile.data().active===false){await authModule.signOut(auth);return;} canManage=profile.exists()&&profile.data().roles?.admin===true; adminOnlyElements.forEach((element)=>{element.hidden=!canManage;}); await load(); });
