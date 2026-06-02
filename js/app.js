  const ROLES={
    admin:  {label:'Admin',  icon:'🛡️',accent:'#e63946',glow:'rgba(230,57,70,.45)'},
    coach:  {label:'Coach',  icon:'📋',accent:'#f4a261',glow:'rgba(244,162,97,.45)'},
    athlete:{label:'Athlete',icon:'⚡',accent:'#2ec4b6',glow:'rgba(46,196,182,.45)'},
  };
  const GROUP_COLORS=['#f4a261','#e63946','#2ec4b6','#a78bfa','#34d399','#fb923c','#60a5fa','#f472b6'];

  let currentRole='admin', currentUser=null, menuOpen=false;

  /* ══ AUTO-LOGIN (Se souvenir de moi) ══ */
  (async function tryAutoLogin(){
    try {
      const saved = localStorage.getItem('app_session');
      if(!saved) return;
      const session = JSON.parse(saved);
      if(!session.username || !session.password || !session.role) return;

      // Vérifier les credentials en DB
      const rows = await sbFetch('users?username=eq.'+encodeURIComponent(session.username)+'&select=*');
      if(!rows || !rows.length) { localStorage.removeItem('app_session'); return; }
      const u = rows[0];
      if(u.password !== session.password || u.role !== session.role) {
        localStorage.removeItem('app_session'); return;
      }

      // Connecter directement
      currentRole = u.role;
      setAccent(u.role);
      currentUser = {username:u.username, firstName:u.first_name, lastName:u.last_name, role:u.role, createdAt:new Date(u.created_at).toLocaleDateString('fr-FR'), id:u.id};
      loadDashboard();
    } catch(e) {
      try{ localStorage.removeItem('app_session'); }catch(e2){}
    }
  })();


  let selectedColor=GROUP_COLORS[0];
  let activeGroupId=null; // group currently open in detail panel

  /* ── STORAGE ── */
  /* ══════════════════════════════════════════
     SUPABASE CONFIG
  ══════════════════════════════════════════ */
  const SB_URL = 'https://lxkkfzovimzygpschxzo.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4a2tmem92aW16eWdwc2NoeHpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MDUyMDEsImV4cCI6MjA4ODI4MTIwMX0.gXUwK8dc6G1WdB7EKnh4vCWt336IN_rATu6C0IDMEuw';

  async function sbFetch(path, method='GET', body=null){
    const headers = {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
    };
    if(method==='POST') headers['Prefer'] = 'return=representation';
    if(method==='PATCH') headers['Prefer'] = 'return=representation';
    const opts = { method, headers, mode: 'cors', credentials: 'omit' };
    if(body) opts.body = JSON.stringify(body);
    const r = await fetch(SB_URL + '/rest/v1/' + path, opts);
    if(!r.ok){ const e=await r.text(); throw new Error('Supabase error: '+e); }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : null;
  }

  /* ── USERS ── */
  async function loadUsers(){
    const rows = await sbFetch('users?select=*');
    const map = {};
    (rows||[]).forEach(u => map[u.username] = {
      firstName: u.first_name, lastName: u.last_name,
      password: u.password, role: u.role,
      createdAt: new Date(u.created_at).toLocaleDateString('fr-FR'),
      id: u.id
    });
    return map;
  }

  async function saveUser(userData){
    // userData: { username, password, firstName, lastName, role }
    await sbFetch('users', 'POST', {
      username: userData.username,
      password: userData.password,
      first_name: userData.firstName,
      last_name: userData.lastName,
      role: userData.role
    });
  }

  // Keep old saveUsers as no-op (not used anymore)
  async function saveUsers(){}

  /* ── COACH DATA ── */
  async function loadCoachData(username){
    try {
      const enc = encodeURIComponent(username);

      // Separate queries with correct Supabase filter syntax
      const [groups, athletes] = await Promise.all([
        sbFetch('groups?coach_username=eq.'+enc+'&select=*'),
        sbFetch('athletes?coach_username=eq.'+enc+'&select=*'),
      ]);

      // Load related data using "in" filter — correct syntax for multiple IDs
      const groupIds = (groups||[]).map(g=>g.id);
      const athleteIds = (athletes||[]).map(a=>a.id);

      const [groupMembers, seances, schedules, tests, completions] = await Promise.all([
        groupIds.length
          ? sbFetch('group_members?group_id=in.('+groupIds.join(',')+')&select=*')
          : Promise.resolve([]),
        athleteIds.length
          ? sbFetch('seances?athlete_id=in.('+athleteIds.join(',')+')&select=*&order=created_at.desc')
          : Promise.resolve([]),
        athleteIds.length
          ? sbFetch('schedule?athlete_id=in.('+athleteIds.join(',')+')&select=*&order=position.asc')
          : Promise.resolve([]),
        athleteIds.length
          ? sbFetch('tests?athlete_id=in.('+athleteIds.join(',')+')&select=*&order=created_at.desc')
          : Promise.resolve([]),
      ]);

      // Normalize groups
      const normGroups = (groups||[]).map(g => ({
        id: g.id,
        name: g.name,
        emoji: g.emoji || '👥',
        color: g.color || '#f4a261',
        createdAt: new Date(g.created_at).toLocaleDateString('fr-FR'),
        members: (groupMembers||[]).filter(m=>m.group_id===g.id).map(m => ({
          id: m.id,
          firstName: m.first_name,
          lastName: m.last_name,
          sport: m.sport,
          addedAt: new Date(m.added_at).toLocaleDateString('fr-FR')
        }))
      }));

      // Normalize athletes
      const normAthletes = (athletes||[]).map(a => {
        const aSeances = (seances||[]).filter(s=>s.athlete_id===a.id);
        const aSchedule = (schedules||[]).filter(s=>s.athlete_id===a.id);

        const schedMap = {};
        aSchedule.forEach(s => {
          const key = s.date;
          if(!schedMap[key]) schedMap[key] = [];
          const seance = aSeances.find(x=>x.id===s.seance_id)||{};
          schedMap[key].push({
            sid: s.seance_id,
            title: seance.title||'—',
            type: seance.type||'ligne',
            color: seance.color||'#2ec4b6',
            content: seance.content||'',
            scheduleId: s.id,
            position: s.position||0
          });
          schedMap[key].sort((x,y)=>x.position-y.position);
        });

        return {
          id: a.id,
          firstName: a.first_name,
          lastName: a.last_name,
          sport: a.sport,
          age: a.age,
          height: a.height,
          weight: a.weight,
          sexe: a.sexe,
          code: a.code || null,
          athleteUsername: a.athlete_username || null,
          createdAt: new Date(a.created_at).toLocaleDateString('fr-FR'),
          completions: (completions||[]).filter(r=>r.athlete_id===a.id),
          seances: aSeances.map(s=>({
            id: s.id, type: s.type, title: s.title,
            content: s.content,
            color: s.color || '#2ec4b6',
            rpe: s.rpe ?? null,
            date: new Date(s.created_at).toLocaleDateString('fr-FR')
          })),
          schedule: schedMap,
          tests: (tests||[]).filter(t=>t.athlete_id===a.id).map(t=>({
            id: t.id,
            name: t.name,
            score: t.score,
            rawDate: t.created_at,
            date: new Date(t.created_at).toLocaleDateString('fr-FR')
          }))
        };
      });

      const result = { groups: normGroups, athletes: normAthletes };
      window._lastCoachData = result;
      return result;
    } catch(err) {
      console.error('loadCoachData error:', err);
      return { groups: [], athletes: [] };
    }
  }

  /* saveCoachData is replaced by granular functions below — keep as no-op */
  async function saveCoachData(username, data){ /* handled by granular functions */ }

  /* ── UI HELPERS ── */
  function setAccent(k){const r=ROLES[k];document.documentElement.style.setProperty('--accent',r.accent);document.documentElement.style.setProperty('--glow',r.glow)}
  function setBadge(id,k){const r=ROLES[k],el=document.getElementById(id);el.textContent=r.icon+'  '+r.label;el.style.color=r.accent;el.style.borderColor=r.accent;el.style.background=`color-mix(in srgb,${r.accent} 12%,transparent)`}
  function showScreen(id){document.querySelectorAll('.screen').forEach(s=>{if(s.id===id){s.classList.remove('exit');requestAnimationFrame(()=>s.classList.add('active'))}else if(s.classList.contains('active')){s.classList.add('exit');setTimeout(()=>s.classList.remove('active','exit'),420)}})}
  function showMsg(id,t,tp){const el=document.getElementById(id);el.textContent=t;el.className='msg '+tp}
  function clearMsg(id){const el=document.getElementById(id);el.className='msg';el.textContent=''}
  function setLoading(id,v,l){const b=document.getElementById(id);b.disabled=v;b.innerHTML=v?`<span class="spinner"></span>${l}`:l}

  /* ── NAV ── */
  function goToLogin(k){currentRole=k;setAccent(k);setBadge('login-badge',k);clearMsg('login-msg');document.getElementById('login-user').value='';document.getElementById('login-pass').value='';showScreen('screen-login')}
  function goToRegister(){setBadge('register-badge',currentRole);clearMsg('register-msg');['reg-first','reg-last','reg-user','reg-pass','reg-pass2'].forEach(i=>document.getElementById(i).value='');showScreen('screen-register')}
  function toggleMenu(){menuOpen=!menuOpen;document.getElementById('dropdown').classList.toggle('open',menuOpen)}
  document.addEventListener('click',e=>{if(menuOpen&&!e.target.closest('.navbar-right')){menuOpen=false;document.getElementById('dropdown').classList.remove('open')}})
  function switchSection(name){document.querySelectorAll('.section-panel').forEach(p=>p.classList.remove('active'));document.getElementById('panel-'+name).classList.add('active');document.querySelectorAll('.dropdown-item').forEach(i=>i.classList.remove('active-section'));event.currentTarget.classList.add('active-section');menuOpen=false;document.getElementById('dropdown').classList.remove('open')}

  /* ── AUTH ── */
  async function handleRegister(){
    const first=document.getElementById('reg-first').value.trim(),last=document.getElementById('reg-last').value.trim();
    const user=document.getElementById('reg-user').value.trim().toLowerCase(),pass=document.getElementById('reg-pass').value,pass2=document.getElementById('reg-pass2').value;
    clearMsg('register-msg');
    if(!first||!last||!user||!pass||!pass2)return showMsg('register-msg','Veuillez remplir tous les champs.','error');
    if(pass!==pass2)return showMsg('register-msg','Les mots de passe ne correspondent pas.','error');
    if(pass.length<4)return showMsg('register-msg','Mot de passe trop court (min. 4 caractères).','error');
    setLoading('register-submit-btn',true,'Création...');
    try {
      const existing=await sbFetch('users?username=eq.'+encodeURIComponent(user)+'&select=id');
      if(existing&&existing.length){setLoading('register-submit-btn',false,'Créer mon compte');return showMsg('register-msg','Cet identifiant est déjà utilisé.','error')}
      await saveUser({username:user,password:pass,firstName:first,lastName:last,role:currentRole});
    } catch(err){setLoading('register-submit-btn',false,'Créer mon compte');return showMsg('register-msg','Erreur : '+err.message,'error');}
    setLoading('register-submit-btn',false,'Créer mon compte');
    showMsg('register-msg','✓ Compte créé ! Vous pouvez vous connecter.','success');
    setTimeout(()=>showScreen('screen-login'),1600);
  }

  async function handleLogin(){
    const user=document.getElementById('login-user').value.trim().toLowerCase(),pass=document.getElementById('login-pass').value;
    clearMsg('login-msg');
    if(!user||!pass)return showMsg('login-msg','Veuillez remplir tous les champs.','error');
    setLoading('login-submit-btn',true,'Connexion...');
    try {
      const rows = await sbFetch('users?username=eq.'+encodeURIComponent(user)+'&select=*');
      if(!rows||!rows.length){setLoading('login-submit-btn',false,'Se connecter');return showMsg('login-msg','Identifiant ou mot de passe incorrect.','error')}
      const u = rows[0];
      if(u.password!==pass){setLoading('login-submit-btn',false,'Se connecter');return showMsg('login-msg','Identifiant ou mot de passe incorrect.','error')}
      if(u.role!==currentRole){setLoading('login-submit-btn',false,'Se connecter');return showMsg('login-msg',`Ce compte est enregistré comme "${ROLES[u.role].label}".`,'error')}
      currentUser={username:u.username,firstName:u.first_name,lastName:u.last_name,role:u.role,createdAt:new Date(u.created_at).toLocaleDateString('fr-FR'),id:u.id};
      setLoading('login-submit-btn',false,'Se connecter');
      // Se souvenir de moi
      if(document.getElementById('remember-me')?.checked){
        try{ localStorage.setItem('app_session', JSON.stringify({username:u.username, password:pass, role:u.role})); }catch(e){}
      } else {
        try{ localStorage.removeItem('app_session'); }catch(e){}
      }
      loadDashboard();
    } catch(err){
      setLoading('login-submit-btn',false,'Se connecter');
      showMsg('login-msg','Erreur de connexion : '+err.message,'error');
    }
  }

  async function loadDashboard(){
    const u=currentUser,r=ROLES[u.role];
    setAccent(u.role);
    document.getElementById('nav-avatar').textContent=u.firstName[0].toUpperCase();
    document.getElementById('nav-avatar').style.background=r.accent;
    document.getElementById('nav-username').textContent=u.firstName;
    const nb=document.getElementById('nav-role-badge');nb.textContent=r.icon+' '+r.label;nb.style.color=r.accent;nb.style.borderColor=r.accent;nb.style.background=`color-mix(in srgb,${r.accent} 12%,transparent)`;
    document.getElementById('dd-fullname').textContent=u.firstName+' '+u.lastName;
    document.getElementById('dd-role').textContent=r.label;
    document.getElementById('prof-first').textContent=u.firstName;
    document.getElementById('prof-last').textContent=u.lastName;
    document.getElementById('prof-user').textContent=u.username;
    document.getElementById('prof-role').textContent=r.icon+' '+r.label;
    if(u.role==='coach') renderCoachUsernameEdit(false);
    document.querySelectorAll('.section-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('panel-tableau-de-bord').classList.add('active');
    if(u.role==='coach') await buildCoachDashboard();
    else await buildGenericDashboard();
    showScreen('screen-dashboard');
  }

  let athWeekOffset = 0;
  let athData = null; // {athlete, seances, schedule, tests}

  async function buildGenericDashboard(){
    const u = currentUser;
    if(u.role !== 'athlete'){
      const r = ROLES[u.role];
      document.getElementById('panel-tableau-de-bord').innerHTML=`
        <div class="section-title">Tableau de bord</div>
        <div class="section-sub">Bonjour ${u.firstName}, bienvenue sur votre espace ${r.label}.</div>
        <div class="info-grid">
          <div class="info-card"><div class="info-card-label">Rôle</div><div class="info-card-value">${r.icon} ${r.label}</div></div>
          <div class="info-card"><div class="info-card-label">Statut</div><div class="info-card-value" style="color:#2ec4b6">✓ Connecté</div></div>
          <div class="info-card"><div class="info-card-label">Membre depuis</div><div class="info-card-value">${u.createdAt||'—'}</div></div>
        </div>`;
      return;
    }

    // Athlète — vérifier le lien
    const savedLink = (() => { try{ return JSON.parse(localStorage.getItem('athlete_link_'+u.username)||'null'); }catch(e){return null;} })();

    if(!savedLink){
      document.getElementById('panel-tableau-de-bord').innerHTML = `
        <div class="ath-no-sync">
          <div class="ath-no-sync-icon">🔗</div>
          <div class="ath-no-sync-title">Pas encore synchronisé</div>
          <div class="ath-no-sync-sub">Demandez le code à votre coach et entrez-le pour accéder à votre espace personnalisé</div>
          ${renderAthleteSyncBlock(null)}
        </div>`;
      return;
    }

    // Charger les données de l'athlète
    document.getElementById('panel-tableau-de-bord').innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;color:rgba(240,236,228,.3)">⏳ Chargement…</div>`;
    try {
      const [athleteRows, seanceRows, scheduleRows, testRows, completionRows] = await Promise.all([
        sbFetch('athletes?id=eq.'+savedLink.athleteId+'&select=*'),
        sbFetch('seances?athlete_id=eq.'+savedLink.athleteId+'&select=*&order=created_at.desc'),
        sbFetch('schedule?athlete_id=eq.'+savedLink.athleteId+'&select=*&order=position.asc'),
        sbFetch('tests?athlete_id=eq.'+savedLink.athleteId+'&select=*&order=created_at.desc'),
        sbFetch('seance_completions?athlete_id=eq.'+savedLink.athleteId+'&select=*'),
      ]);
      const a = athleteRows?.[0] || {};
      // Construire schedMap
      const schedMap = {};
      (scheduleRows||[]).forEach(s => {
        if(!schedMap[s.date]) schedMap[s.date] = [];
        const seance = (seanceRows||[]).find(x=>x.id===s.seance_id)||{};
        schedMap[s.date].push({ sid:s.seance_id, title:seance.title||'—', type:seance.type||'ligne', color:seance.color||'#2ec4b6', content:seance.content||'', scheduleId:s.id, position:s.position||0 });
        schedMap[s.date].sort((x,y)=>x.position-y.position);
      });
      // Map completions: "seanceId|date" -> {id, completed_at}
      const compMap = {};
      (completionRows||[]).forEach(r => { compMap[r.seance_id+'|'+r.schedule_date] = {id:r.id, completedAt:r.completed_at, rpe:r.rpe_ressenti??null}; });

      athData = {
        athlete: a,
        seances: (seanceRows||[]).map(s=>({id:s.id,type:s.type,title:s.title,content:s.content,color:s.color||'#2ec4b6',rpe:s.rpe??null,date:new Date(s.created_at).toLocaleDateString('fr-FR')})),
        schedule: schedMap,
        tests: (testRows||[]).map(t=>({id:t.id,name:t.name,score:t.score,rawDate:t.created_at,date:new Date(t.created_at).toLocaleDateString('fr-FR')})),
        profile: { firstName:a.first_name, lastName:a.last_name, sport:a.sport, age:a.age, height:a.height, weight:a.weight, sexe:a.sexe },
        completions: compMap
      };
      athWeekOffset = 0;
      renderAthDashboard();
    } catch(err){
      document.getElementById('panel-tableau-de-bord').innerHTML = `<div style="padding:40px;color:#e63946">Erreur de chargement : ${err.message}</div>`;
    }
  }

  function renderAthDashboard(){
    const u = currentUser;
    document.getElementById('panel-tableau-de-bord').innerHTML = `
      <div class="ath-dash" id="ath-dash">
        <!-- Planning semaine -->
        <div class="ath-week-header">
          <div class="ath-week-title">Planning</div>
          <div class="ath-week-nav">
            <button onclick="athShiftWeek(-1)">◀</button>
            <span class="ath-week-range" id="ath-week-range"></span>
            <button onclick="athShiftWeek(1)">▶</button>
          </div>
        </div>
        <div class="ath-week-grid" id="ath-week-grid"></div>
        <div id="ath-day-detail"></div>

        <!-- Onglets -->
        <div class="ath-tabs">
          <div class="ath-tab active" id="athtab-seances" onclick="switchAthTab('seances')">
            <span class="ath-tab-icon">🏋️</span>Séances
          </div>
          <div class="ath-tab" id="athtab-tests" onclick="switchAthTab('tests')">
            <span class="ath-tab-icon">📊</span>Tests
          </div>
          <div class="ath-tab" id="athtab-profil" onclick="switchAthTab('profil')">
            <span class="ath-tab-icon">👤</span>Profil
          </div>
        </div>

        <!-- Contenu onglets -->
        <div class="ath-tab-content">
          <div class="ath-tab-panel active" id="athpanel-seances"></div>
          <div class="ath-tab-panel" id="athpanel-tests"></div>
          <div class="ath-tab-panel" id="athpanel-profil"></div>
        </div>
      </div>`;

    athRenderWeek();
    athRenderSeances();
    athRenderTests();
    athRenderProfil();
  }

  function switchAthTab(name){
    document.querySelectorAll('.ath-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.ath-tab-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('athtab-'+name)?.classList.add('active');
    document.getElementById('athpanel-'+name)?.classList.add('active');
  }

  function athShiftWeek(dir){
    athWeekOffset += dir;
    athRenderWeek();
    athRenderSeances(); // mettre à jour la liste des séances selon la semaine
  }

  function athRenderWeek(){
    if(!athData) return;
    const days = getWeekDays(athWeekOffset);
    const today = new Date(); today.setHours(0,0,0,0);
    const DAYS_SHORT = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];

    // Range label
    const first = days[0], last = days[6];
    const fmt = d => d.getDate()+'/'+(d.getMonth()+1);
    document.getElementById('ath-week-range').textContent = fmt(first)+' – '+fmt(last);

    document.getElementById('ath-week-grid').innerHTML = days.map(d => {
      const key = dateToKey(d);
      const slots = athData.schedule[key] || [];
      const isToday = d.getTime() === today.getTime();
      const pillsHtml = slots.length
        ? slots.map(s=>{
            const isComp = !!((athData.completions||{})[s.sid+'|'+key]);
            return `<div class="ath-pill${isComp?' completed':''}" style="border-left-color:${s.color}" onclick="athOpenDay('${key}')">
              <span class="ath-pill-title${isComp?' done':''}">${escHtml(s.title)}</span>
              ${isComp ? `<div class="ath-pill-comp-row">✓ Complété</div>` : ''}
            </div>`;
          }).join('')
        : `<div class="ath-day-empty"></div>`;
      return `
        <div class="ath-day-col">
          <div class="ath-day-header${isToday?' today':''}" onclick="athOpenDay('${key}')">
            ${DAYS_SHORT[d.getDay()]}<div class="ath-day-num">${d.getDate()}</div>
          </div>
          <div class="ath-day-slots">${pillsHtml}</div>
        </div>`;
    }).join('');
  }

  let _athCurrentDateKey = null;

  function athOpenDay(dateKey){
    _athCurrentDateKey = dateKey;
    const slots = athData.schedule[dateKey] || [];
    const detail = document.getElementById('ath-day-detail');
    if(!detail) return;
    if(!slots.length){ detail.innerHTML=''; return; }
    const d = keyToDate(dateKey);
    const DAYS_FULL = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const MONTHS = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
    const label = DAYS_FULL[d.getDay()]+' '+d.getDate()+' '+MONTHS[d.getMonth()];
    const seancesHtml = slots.map((slot,i)=>{
      const seance = athData.seances.find(x=>x.id===slot.sid)||{content:slot.content,type:slot.type};
      const bodyHtml = seance.type==='ligne'
        ? `<div style="font-size:13px;color:rgba(240,236,228,.7);line-height:1.7">${escHtml(typeof seance.content==='string'?seance.content:'')}</div>`
        : athBlockReadHtml(seance);
      const compKey = slot.sid+'|'+dateKey;
      const comp = (athData.completions||{})[compKey];
      const isDone = !!comp;
      const doneDate = isDone ? new Date(comp.completedAt).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      return `
        <div class="ath-seance-item" style="border-left-color:${slot.color}" id="athday-${i}">
          <div class="ath-seance-header" onclick="athToggleSeance('athday-${i}')">
            <span class="seance-type-badge ${slot.type}">${slot.type==='ligne'?'Ligne':'Block'}</span>
            <span class="ath-seance-name">${escHtml(slot.title)}</span>
            <span class="ath-seance-chevron">▼</span>
          </div>
          <div class="ath-seance-body">
            ${bodyHtml}
            <button class="ath-complete-btn${isDone?' done':''}" id="athcomplete-${i}" onclick="athToggleComplete('${slot.sid}','${dateKey}',${i})">
              <div class="ath-complete-checkbox"><span class="ath-complete-checkmark">✓</span></div>
              <span class="ath-complete-label">${isDone ? 'Séance complétée !' : 'Marquer comme terminée'}</span>
              ${isDone ? `<span class="ath-complete-date">${doneDate}</span>` : ''}
            </button>
          </div>
        </div>`;
    }).join('');
    detail.innerHTML = `
      <div class="ath-day-detail">
        <div class="ath-day-detail-title">📅 ${label}</div>
        ${seancesHtml}
      </div>`;
  }

  async function athToggleComplete(sid, dateKey, idx){
    const savedLink = (()=>{ try{ return JSON.parse(localStorage.getItem('athlete_link_'+currentUser.username)||'null'); }catch(e){return null;} })();
    if(!savedLink) return;
    const compKey = sid+'|'+dateKey;
    const comp = (athData.completions||{})[compKey];
    const btn = document.getElementById('athcomplete-'+idx);

    try {
      if(comp){
        // Décocher — supprimer
        await sbFetch('seance_completions?id=eq.'+comp.id, 'DELETE');
        delete athData.completions[compKey];
        if(btn){
          btn.classList.remove('done');
          btn.querySelector('.ath-complete-label').textContent='Marquer comme terminée';
          const dateEl = btn.querySelector('.ath-complete-date');
          if(dateEl) dateEl.remove();
        }
      } else {
        // Cocher — insérer
        const rows = await sbFetch('seance_completions','POST',{
          athlete_id: savedLink.athleteId,
          seance_id: sid,
          schedule_date: dateKey
        });
        const now = new Date().toISOString();
        if(!athData.completions) athData.completions = {};
        athData.completions[compKey] = {id: rows?.[0]?.id || 'temp', completedAt: now};
        if(btn){
          btn.classList.add('done');
          btn.querySelector('.ath-complete-label').textContent='Séance complétée !';
          const doneDate = new Date(now).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
          if(!btn.querySelector('.ath-complete-date')){
            const span = document.createElement('span');
            span.className='ath-complete-date';
            span.textContent=doneDate;
            btn.appendChild(span);
          }
        }
      }
      // Refresh pills planning + liste séances
      athRenderWeek();
      athRenderSeances();
    } catch(err){ console.error('athToggleComplete:', err); }
  }

  function athToggleSeance(id){
    document.getElementById(id)?.classList.toggle('open');
  }

  function athBlockReadHtml(seance){
    const circuits = Array.isArray(seance.content) ? seance.content : [];
    const rpeColor = seance.rpe!=null ? RPE_COLORS[seance.rpe] : '#2ec4b6';
    const rpeHtml = seance.rpe!=null ? `
      <div class="block-rpe-badge" style="margin-bottom:12px">
        <span style="font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(240,236,228,.3)">RPE</span>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:${rpeColor};line-height:1">${seance.rpe}</span>
        <span style="font-size:12px;color:${rpeColor}">${RPE_LABELS[seance.rpe]||''}</span>
      </div>` : '';
    const blocksHtml = circuits.map((circ,ci)=>{
      const exercises = circ.exercises||[];
      const label = circ.name||(circuits.length>1?`Block ${ci+1}`:'Exercices');
      const seriesLabel = circ.series ? ` — ${circ.series} série${parseInt(circ.series)>1?'s':''}` : '';
      const exHtml = exercises.length ? exercises.map((ex,ei)=>{
        const e = typeof ex==='object'?ex:{name:ex||'',reps:'',intensity:'',url:''};
        const videoLink = e.url ? `<a class="block-read-video-link" href="${escHtml(e.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">▶ Vidéo</a>` : '';
        return `<div class="block-read-exercise">
          <span class="block-read-ex-num">${ei+1}</span>
          <span class="block-read-ex-name">${escHtml(e.name||'—')}</span>
          ${e.reps?`<span class="block-read-sep">|</span><span class="block-read-tag reps">${escHtml(e.reps)}</span>`:''}
          ${e.intensity?`<span class="block-read-sep">|</span><span class="block-read-tag intensity">${escHtml(e.intensity)}</span>`:''}
          ${videoLink}
        </div>`;
      }).join('') : `<div class="block-read-empty">Aucun exercice.</div>`;
      const blockBtnId = 'asp-block-btn-'+ci;
      const blockBtn = `<button class="asp-block-validate-btn" id="${blockBtnId}" onclick="aspToggleBlock(${ci}, '${blockBtnId}')">
        ✓ Valider ce bloc
      </button>`;
      return `<div class="block-read-section"><div class="block-read-label">${escHtml(label)}${seriesLabel}</div>${exHtml}${blockBtn}</div>`;
    }).join('');
    return `<div style="padding-top:8px">${rpeHtml}${blocksHtml}</div>`;
  }

  function athRenderSeances(){
    const el = document.getElementById('athpanel-seances');
    if(!el||!athData) return;

    // Construire la liste des séances planifiées cette semaine, triées par date
    const weekDays = getWeekDays(athWeekOffset);
    const seancesInWeek = []; // [{date, dateKey, seance}]
    const seenIds = new Set();

    weekDays.forEach(d => {
      const key = dateToKey(d);
      const slots = athData.schedule[key] || [];
      slots.forEach(slot => {
        if(seenIds.has(slot.sid)) return; // pas de doublon si même séance plusieurs jours
        const seance = athData.seances.find(s => s.id === slot.sid);
        if(seance){
          seancesInWeek.push({ date: d, dateKey: key, seance });
          seenIds.add(slot.sid);
        }
      });
    });

    if(!seancesInWeek.length){
      el.innerHTML = `<div class="adp-empty"><div class="adp-empty-icon">🏋️</div><div class="adp-empty-title">Aucune séance cette semaine</div>Votre coach n'a pas encore planifié de séances pour cette semaine.</div>`;
      return;
    }

    const DAYS_FR = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    const comps = athData.completions || {};

    // Séparer à faire / terminées
    const todo = seancesInWeek.filter(({dateKey, seance}) => !comps[seance.id+'|'+dateKey]);
    const done = seancesInWeek.filter(({dateKey, seance}) => !!comps[seance.id+'|'+dateKey]);

    const renderCard = ({date, dateKey, seance}, i, isDone) => {
      const dayLabel = DAYS_FR[date.getDay()] + ' ' + date.getDate();
      const comp = comps[seance.id+'|'+dateKey];
      const rpe = isDone && comp && comp.rpe !== null && comp.rpe !== undefined ? comp.rpe : null;
      const rpeCol = rpe !== null ? RPE_COLORS[rpe] : '';
      const rpeBadge = rpe !== null
        ? `<span style="font-family:'Bebas Neue',sans-serif;font-size:15px;color:${rpeCol};background:${rpeCol}22;border:1px solid ${rpeCol}55;border-radius:6px;padding:1px 7px;margin-right:4px">${rpe}</span>`
        : '';
      return `
      <div class="ath-seance-card" style="border-left-color:${isDone ? 'rgba(46,196,182,.3)' : seance.color};${isDone ? 'opacity:0.55' : ''};cursor:pointer"
        onclick="openAthSeancePanel('${seance.id}','${dateKey}')">
        <div class="ath-seance-card-hdr">
          <span class="seance-type-badge ${seance.type}">${seance.type==='ligne'?'Ligne':'Block'}</span>
          <span class="ath-seance-card-title" style="${isDone ? 'text-decoration:line-through;color:rgba(240,236,228,.4)' : ''}">${escHtml(seance.title)}</span>
          ${isDone ? '<span style="font-size:10px;font-weight:700;color:#2ec4b6;margin-left:4px">✓</span>' : ''}
          <span style="margin-left:auto;display:flex;align-items:center;gap:6px">
            ${rpeBadge}
            <span style="font-size:11px;color:rgba(240,236,228,.35);white-space:nowrap">${dayLabel}</span>
          </span>
          <span style="color:rgba(240,236,228,.3);font-size:14px;margin-left:6px">›</span>
        </div>
      </div>`;
    };

    const todoHtml = todo.map((item, i) => renderCard(item, i, false)).join('');
    const doneHtml = done.length ? `
      <div style="display:flex;align-items:center;gap:10px;margin:16px 0 10px;opacity:0.4">
        <div style="flex:1;height:1px;background:rgba(255,255,255,.2)"></div>
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(240,236,228,.5)">Terminées</span>
        <div style="flex:1;height:1px;background:rgba(255,255,255,.2)"></div>
      </div>
      ${done.map((item, i) => renderCard(item, i, true)).join('')}
    ` : '';

    el.innerHTML = todoHtml + doneHtml;
  }

  function athRenderTests(){
    const el = document.getElementById('athpanel-tests');
    if(!el||!athData) return;

    // Header avec bouton + formulaire
    const headerHtml = `
      <div class="tests-header">
        <div class="tests-title">Tests</div>
        <button class="add-btn" onclick="athShowTestForm()">+ Ajouter un test</button>
      </div>
      <div id="ath-test-form-wrap"></div>`;

    if(!athData.tests.length){
      el.innerHTML = headerHtml + `<div class="adp-empty"><div class="adp-empty-icon">📊</div><div class="adp-empty-title">Aucun test</div>Ajoutez votre premier test !</div>`;
      return;
    }

    // Grouper par nom
    const groups = {};
    athData.tests.forEach(t=>{ if(!groups[t.name]) groups[t.name]=[]; groups[t.name].push(t); });
    Object.values(groups).forEach(g=>g.sort((a,b)=>new Date(a.rawDate)-new Date(b.rawDate)));
    const listHtml = Object.entries(groups).map(([name,entries])=>{
      const last = entries[entries.length-1];
      return `<div class="test-group-card" onclick="athOpenTestGraph('${escHtml(name).replace(/'/g,"\'")}')">
        <div class="test-group-icon">📊</div>
        <div class="test-group-info">
          <div class="test-group-name">${escHtml(name)}</div>
          <div class="test-group-meta">
            <span class="test-group-last">${escHtml(last.score)}</span>
            <span class="test-group-count">${entries.length} entrée${entries.length>1?'s':''} · dernier ${last.date}</span>
          </div>
        </div>
        <span class="test-group-arrow">›</span>
      </div>`;
    }).join('');

    el.innerHTML = headerHtml + `<div class="tests-list">${listHtml}</div>`;
  }

  function athOpenTestGraph(name){
    _testGroups = {};
    athData.tests.forEach(t=>{ if(!_testGroups[t.name]) _testGroups[t.name]=[]; _testGroups[t.name].push(t); });
    Object.values(_testGroups).forEach(g=>g.sort((a,b)=>new Date(a.rawDate)-new Date(b.rawDate)));
    // Mode athlète : activer ajout + suppression avec refresh athData
    _athTestMode = true;
    openTestGraph(name);
  }

  let _athTestMode = false;

  // Fonctions test côté athlète
  function athShowTestForm(){
    const wrap = document.getElementById('ath-test-form-wrap');
    if(!wrap) return;
    wrap.innerHTML = `
      <div class="test-add-form" id="ath-test-add-form">
        <div class="test-add-row">
          <div class="test-add-field">
            <span class="test-add-label">Nom du test</span>
            <input class="test-add-input" id="ath-ta-name" type="text" placeholder="Ex : 1RM Squat, VMA, Cooper…" autofocus/>
          </div>
          <div class="test-add-field" style="flex:none">
            <span class="test-add-label">Score</span>
            <input class="test-add-input score" id="ath-ta-score" type="text" placeholder="Ex : 120kg, 17.5…"/>
          </div>
          <button class="test-add-submit" onclick="athSubmitTest()">Valider</button>
        </div>
        <button class="test-add-cancel" onclick="athHideTestForm()">✕ Annuler</button>
      </div>`;
    setTimeout(()=>document.getElementById('ath-ta-name')?.focus(), 50);
  }

  function athHideTestForm(){
    const wrap = document.getElementById('ath-test-form-wrap');
    if(wrap) wrap.innerHTML = '';
  }

  async function athSubmitTest(){
    const savedLink = (()=>{ try{ return JSON.parse(localStorage.getItem('athlete_link_'+currentUser.username)||'null'); }catch(e){return null;} })();
    if(!savedLink) return;
    const name = document.getElementById('ath-ta-name')?.value.trim();
    const score = document.getElementById('ath-ta-score')?.value.trim();
    if(!name || !score) return;
    const btn = document.querySelector('#ath-test-add-form .test-add-submit');
    btn.textContent='⏳'; btn.disabled=true;
    try {
      await sbFetch('tests','POST',{athlete_id: savedLink.athleteId, name, score});
      // Refresh athData.tests
      const testRows = await sbFetch('tests?athlete_id=eq.'+savedLink.athleteId+'&select=*&order=created_at.desc');
      athData.tests = (testRows||[]).map(t=>({id:t.id,name:t.name,score:t.score,rawDate:t.created_at,date:new Date(t.created_at).toLocaleDateString('fr-FR')}));
      athHideTestForm();
      athRenderTests();
    } catch(err){
      btn.textContent='Valider'; btn.disabled=false;
      console.error('athSubmitTest:', err);
    }
  }


  /* ══ ÉDITION PROFIL — PARTAGÉE ══ */
  let _editProfilSexe = null;

  function profilSexeSelect(val, elId, isTeal){
    _editProfilSexe = val;
    const cls = isTeal ? 'profil-sexe-btn sel teal' : 'profil-sexe-btn sel';
    document.querySelectorAll(`#${elId} .profil-sexe-btn`).forEach(b=>{
      b.className = b.dataset.val===val ? cls : 'profil-sexe-btn';
    });
  }

  function buildProfilEditHtml(p, saveFunc, cancelFunc, isTeal){
    const accentClass = isTeal ? 'teal' : '';
    return `
      <div class="profil-edit-wrap">
        <div class="profil-edit-grid">
          <div class="profil-edit-field">
            <span class="profil-edit-label">Prénom</span>
            <input class="profil-edit-input" id="pe-first" value="${escHtml(p.firstName||'')}" placeholder="Prénom"/>
          </div>
          <div class="profil-edit-field">
            <span class="profil-edit-label">Nom</span>
            <input class="profil-edit-input" id="pe-last" value="${escHtml(p.lastName||'')}" placeholder="Nom"/>
          </div>
          <div class="profil-edit-field">
            <span class="profil-edit-label">Sport</span>
            <input class="profil-edit-input" id="pe-sport" value="${escHtml(p.sport||'')}" placeholder="Ex: Powerlifting…"/>
          </div>
          <div class="profil-edit-field">
            <span class="profil-edit-label">Âge</span>
            <input class="profil-edit-input" id="pe-age" type="number" value="${p.age||''}" placeholder="Ex: 24"/>
          </div>
          <div class="profil-edit-field">
            <span class="profil-edit-label">Taille (cm)</span>
            <input class="profil-edit-input" id="pe-height" type="number" step="0.1" value="${p.height||''}" placeholder="Ex: 178"/>
          </div>
          <div class="profil-edit-field">
            <span class="profil-edit-label">Poids (kg)</span>
            <input class="profil-edit-input" id="pe-weight" type="number" step="0.1" value="${p.weight||''}" placeholder="Ex: 82"/>
          </div>
          <div class="profil-edit-field" style="grid-column:1/-1">
            <span class="profil-edit-label">Sexe</span>
            <div class="profil-sexe-row" id="pe-sexe-row">
              <button class="profil-sexe-btn${p.sexe==='Homme'?' sel'+( isTeal?' teal':''):''}" data-val="Homme" onclick="profilSexeSelect('Homme','pe-sexe-row',${isTeal})">Homme</button>
              <button class="profil-sexe-btn${p.sexe==='Femme'?' sel'+( isTeal?' teal':''):''}" data-val="Femme" onclick="profilSexeSelect('Femme','pe-sexe-row',${isTeal})">Femme</button>
              <button class="profil-sexe-btn${p.sexe==='Autre'?' sel'+( isTeal?' teal':''):''}" data-val="Autre" onclick="profilSexeSelect('Autre','pe-sexe-row',${isTeal})">Autre</button>
            </div>
          </div>
        </div>
        <div class="profil-edit-actions">
          <button class="profil-save-btn ${accentClass}" onclick="${saveFunc}()">✓ Enregistrer</button>
          <button class="profil-cancel-btn" onclick="${cancelFunc}()">Annuler</button>
        </div>
      </div>`;
  }

  function getProfilEditValues(){
    return {
      first_name: document.getElementById('pe-first')?.value.trim()||'',
      last_name:  document.getElementById('pe-last')?.value.trim()||'',
      sport:      document.getElementById('pe-sport')?.value.trim()||null,
      age:        parseInt(document.getElementById('pe-age')?.value)||null,
      height:     parseFloat(document.getElementById('pe-height')?.value)||null,
      weight:     parseFloat(document.getElementById('pe-weight')?.value)||null,
      sexe:       _editProfilSexe||null,
    };
  }

  function athRenderProfil(editMode){
    const el = document.getElementById('athpanel-profil');
    if(!el||!athData) return;
    const p = athData.profile;
    const savedLink = (()=>{ try{ return JSON.parse(localStorage.getItem('athlete_link_'+currentUser.username)||'null'); }catch(e){return null;} })();
    _editProfilSexe = p.sexe||null;
    const fields=[
      {label:'Prénom',value:p.firstName||'—'},
      {label:'Nom',value:p.lastName||'—'},
      {label:'Sport',value:p.sport||'—'},
      {label:'Âge',value:p.age?p.age+' ans':'—'},
      {label:'Taille',value:p.height?p.height+' cm':'—'},
      {label:'Poids',value:p.weight?p.weight+' kg':'—'},
      {label:'Sexe',value:p.sexe||'—'},
    ];
    el.innerHTML=`
      <div class="ath-profil-grid">
        ${fields.map(f=>`<div class="ath-profil-card"><div class="ath-profil-label">${f.label}</div><div class="ath-profil-value">${escHtml(String(f.value))}</div></div>`).join('')}
      </div>
      ${editMode ? buildProfilEditHtml(p,'athSaveProfil','athCancelProfil',true) : `<button class="profil-edit-btn" onclick="athRenderProfil(true)">✏️ Modifier mes informations</button>`}
      <div id="ath-username-self-wrap"></div>
      <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.07)">
        <div style="font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:rgba(240,236,228,.3);margin-bottom:8px">Coach</div>
        <div style="font-size:14px;color:rgba(240,236,228,.6)">${savedLink?escHtml(savedLink.coachUsername):'—'}</div>
        <button class="sync-unlink-btn" style="margin-top:14px" onclick="unlinkAthleteCode()">Dissocier le compte</button>
      </div>`;
    renderAthUsernameSelf(false);
  }


  /* ══ MODIFICATION IDENTIFIANT — VUE ATHLÈTE ══ */
  function renderAthUsernameSelf(open){
    const wrap = document.getElementById('ath-username-self-wrap');
    if(!wrap) return;
    const cur = currentUser.username || '';

    if(!open){
      wrap.innerHTML = `
        <div style="margin-top:14px;padding:14px 0;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;gap:14px">
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:rgba(46,196,182,.6);margin-bottom:5px">Mon identifiant de connexion</div>
            <div style="font-size:15px;font-weight:600;color:var(--white)">${escHtml(cur)}</div>
          </div>
          <button class="username-open-btn" style="border-color:rgba(46,196,182,.3);color:rgba(46,196,182,.7)" onclick="renderAthUsernameSelf(true)">✏️ Modifier</button>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.07)">
        <div class="username-edit-box" style="border-color:rgba(46,196,182,.2)">
          <div class="username-edit-title">Modifier mon identifiant de connexion</div>
          <div class="username-edit-row">
            <div class="username-edit-field">
              <span class="username-edit-label">Nouvel identifiant</span>
              <input class="username-edit-input" id="ath-self-username-input"
                type="text" value="${escHtml(cur)}"
                placeholder="Nouvel identifiant…"
                autocomplete="off"/>
            </div>
            <button class="username-save-btn teal" onclick="saveAthUsernameSelf()">Enregistrer</button>
          </div>
          <div class="username-edit-msg" id="ath-self-username-msg"></div>
          <button style="background:none;border:none;color:rgba(240,236,228,.3);font-size:12px;cursor:pointer;margin-top:6px;padding:0" onclick="renderAthUsernameSelf(false)">Annuler</button>
        </div>
      </div>`;
    setTimeout(()=>{ const i=document.getElementById('ath-self-username-input'); if(i) i.focus(); },50);
  }

  async function saveAthUsernameSelf(){
    const savedLink = (()=>{ try{ return JSON.parse(localStorage.getItem('athlete_link_'+currentUser.username)||'null'); }catch(e){return null;} })();
    const input = document.getElementById('ath-self-username-input');
    const msg = document.getElementById('ath-self-username-msg');
    const oldUsername = currentUser.username;
    const newUsername = (input?.value||'').trim().toLowerCase();

    if(!newUsername || newUsername.length < 3){ msg.textContent='Minimum 3 caractères.'; msg.className='username-edit-msg err'; return; }
    if(newUsername === oldUsername){ msg.textContent="C'est déjà votre identifiant."; msg.className='username-edit-msg err'; return; }

    const btn = document.querySelector('#ath-username-self-wrap .username-save-btn');
    btn.textContent='⏳'; btn.disabled=true;

    try {
      const existing = await sbFetch('users?username=eq.'+encodeURIComponent(newUsername)+'&select=id');
      if(existing && existing.length){
        msg.textContent='Cet identifiant est déjà utilisé.'; msg.className='username-edit-msg err';
        btn.textContent='Enregistrer'; btn.disabled=false; return;
      }

      await sbFetch('users?username=eq.'+encodeURIComponent(oldUsername), 'PATCH', {username: newUsername});

      if(savedLink){
        await sbFetch('athletes?id=eq.'+savedLink.athleteId, 'PATCH', {athlete_username: newUsername});
      }

      currentUser.username = newUsername;
      try{
        const saved = JSON.parse(localStorage.getItem('app_session')||'null');
        if(saved){ saved.username = newUsername; localStorage.setItem('app_session', JSON.stringify(saved)); }
        const link = JSON.parse(localStorage.getItem('athlete_link_'+oldUsername)||'null');
        if(link){ localStorage.setItem('athlete_link_'+newUsername, JSON.stringify(link)); localStorage.removeItem('athlete_link_'+oldUsername); }
      }catch(e){}

      msg.textContent='✓ Identifiant mis à jour !'; msg.className='username-edit-msg ok';
      btn.textContent='Enregistrer'; btn.disabled=false;
      setTimeout(()=>renderAthUsernameSelf(false), 1400);
    } catch(err){
      msg.textContent='Erreur : '+err.message; msg.className='username-edit-msg err';
      btn.textContent='Enregistrer'; btn.disabled=false;
    }
  }

  function athCancelProfil(){ athRenderProfil(false); }

  async function athSaveProfil(){
    const savedLink = (()=>{ try{ return JSON.parse(localStorage.getItem('athlete_link_'+currentUser.username)||'null'); }catch(e){return null;} })();
    if(!savedLink) return;
    const vals = getProfilEditValues();
    if(!vals.first_name){ return; }
    const btn = document.querySelector('#athpanel-profil .profil-save-btn');
    if(btn){ btn.textContent='⏳'; btn.disabled=true; }
    try {
      await sbFetch('athletes?id=eq.'+savedLink.athleteId, 'PATCH', vals);
      // Refresh local data
      const rows = await sbFetch('athletes?id=eq.'+savedLink.athleteId+'&select=*');
      if(rows?.[0]){
        const a = rows[0];
        athData.profile = {firstName:a.first_name,lastName:a.last_name,sport:a.sport,age:a.age,height:a.height,weight:a.weight,sexe:a.sexe};
        athData.athlete = a;
      }
      athRenderProfil(false);
    } catch(err){
      if(btn){ btn.textContent='✓ Enregistrer'; btn.disabled=false; }
      console.error('athSaveProfil:', err);
    }
  }


  /* ══ MODIFICATION IDENTIFIANT COACH ══ */
  function renderCoachUsernameEdit(open){
    const wrap = document.getElementById('coach-username-edit-wrap');
    if(!wrap) return;
    if(!open){
      wrap.innerHTML = `<button class="username-open-btn" onclick="renderCoachUsernameEdit(true)">✏️ Modifier mon identifiant</button>`;
      return;
    }
    wrap.innerHTML = `
      <div class="username-edit-box">
        <div class="username-edit-title">Modifier l'identifiant de connexion</div>
        <div class="username-edit-row">
          <div class="username-edit-field">
            <span class="username-edit-label">Nouvel identifiant</span>
            <input class="username-edit-input" id="new-username-input"
              type="text"
              value="${escHtml(currentUser.username)}"
              placeholder="Nouvel identifiant…"
              autocomplete="off"
              oninput="this.value=this.value.toLowerCase().replace(/\s/g,'')"/>
          </div>
          <button class="username-save-btn" onclick="saveCoachUsername()">Enregistrer</button>
        </div>
        <div class="username-edit-msg" id="username-edit-msg"></div>
        <button style="background:none;border:none;color:rgba(240,236,228,.3);font-size:12px;cursor:pointer;margin-top:6px;padding:0" onclick="renderCoachUsernameEdit(false)">Annuler</button>
      </div>`;
    document.getElementById('new-username-input')?.focus();
  }

  async function saveCoachUsername(){
    const input = document.getElementById('new-username-input');
    const msg = document.getElementById('username-edit-msg');
    const newUsername = input?.value.trim().toLowerCase();

    if(!newUsername){ msg.textContent='Entrez un identifiant.'; msg.className='username-edit-msg err'; return; }
    if(newUsername === currentUser.username){ msg.textContent="C'est déjà votre identifiant."; msg.className='username-edit-msg err'; return; }
    if(newUsername.length < 3){ msg.textContent='Minimum 3 caractères.'; msg.className='username-edit-msg err'; return; }

    const btn = document.querySelector('.username-save-btn');
    btn.textContent='⏳'; btn.disabled=true;

    try {
      // Vérifier que le nouvel identifiant n'est pas déjà pris
      const existing = await sbFetch('users?username=eq.'+encodeURIComponent(newUsername)+'&select=id');
      if(existing && existing.length){
        msg.textContent='Cet identifiant est déjà utilisé.'; msg.className='username-edit-msg err';
        btn.textContent='Enregistrer'; btn.disabled=false; return;
      }

      // PATCH dans users
      await sbFetch('users?username=eq.'+encodeURIComponent(currentUser.username), 'PATCH', {username: newUsername});

      // Mettre à jour aussi coach_username dans athletes et groups
      await Promise.all([
        sbFetch('athletes?coach_username=eq.'+encodeURIComponent(currentUser.username), 'PATCH', {coach_username: newUsername}),
        sbFetch('groups?coach_username=eq.'+encodeURIComponent(currentUser.username), 'PATCH', {coach_username: newUsername}),
      ]);

      // Mettre à jour la session locale
      currentUser.username = newUsername;
      document.getElementById('prof-user').textContent = newUsername;
      try{
        const saved = JSON.parse(localStorage.getItem('app_session')||'null');
        if(saved){ saved.username = newUsername; localStorage.setItem('app_session', JSON.stringify(saved)); }
      }catch(e){}

      msg.textContent='✓ Identifiant mis à jour !'; msg.className='username-edit-msg ok';
      btn.textContent='Enregistrer'; btn.disabled=false;
      setTimeout(()=>renderCoachUsernameEdit(false), 1500);
    } catch(err){
      msg.textContent='Erreur : '+err.message; msg.className='username-edit-msg err';
      btn.textContent='Enregistrer'; btn.disabled=false;
    }
  }

  function renderAthleteSyncBlock(link){
    if(link){
      return `<div class="sync-code-wrap">
        <div class="sync-code-icon">🔗</div>
        <div class="sync-code-title">Synchronisé</div>
        <div class="sync-linked-card">
          <div class="sync-linked-name">${escHtml(link.firstName)} ${escHtml(link.lastName)}</div>
          <div class="sync-linked-coach">Coach : ${escHtml(link.coachUsername)}</div>
        </div>
        <button class="sync-unlink-btn" onclick="unlinkAthleteCode()">Dissocier</button>
      </div>`;
    }
    return `<div class="sync-code-wrap">
      <div class="sync-code-icon">🔗</div>
      <div class="sync-code-title">Synchroniser avec votre coach</div>
      <div class="sync-code-sub">Entrez le code fourni par votre coach pour accéder à vos séances et tests</div>
      <div class="sync-code-row">
        <input class="sync-code-input" id="sync-code-input" maxlength="6" placeholder="CODE" oninput="this.value=this.value.toUpperCase()"/>
        <button class="sync-code-btn" onclick="submitAthleteCode()">Lier</button>
      </div>
      <div id="sync-code-msg" style="font-size:12px;color:#e63946;min-height:18px"></div>
    </div>`;
  }

  async function submitAthleteCode(){
    const code = document.getElementById('sync-code-input')?.value.trim().toUpperCase();
    const msg = document.getElementById('sync-code-msg');
    if(!code || code.length < 4){ if(msg) msg.textContent='Entrez un code valide.'; return; }
    const btn = document.querySelector('.sync-code-btn');
    btn.textContent='⏳'; btn.disabled=true;
    try {
      const rows = await sbFetch('athletes?code=eq.'+encodeURIComponent(code)+'&select=*');
      if(!rows || !rows.length){
        if(msg) msg.textContent='Code introuvable. Vérifiez avec votre coach.';
        btn.textContent='Lier'; btn.disabled=false; return;
      }
      const a = rows[0];

      // Lier l'username de l'athlète à son entrée athletes
      await sbFetch('athletes?id=eq.'+a.id, 'PATCH', {athlete_username: currentUser.username});

      const link = {
        athleteId: a.id,
        firstName: a.first_name,
        lastName: a.last_name,
        coachUsername: a.coach_username,
        code
      };
      localStorage.setItem('athlete_link_'+currentUser.username, JSON.stringify(link));
      btn.textContent='Lier'; btn.disabled=false;
      buildGenericDashboard(); // refresh
    } catch(err){
      if(msg) msg.textContent='Erreur : '+err.message;
      btn.textContent='Lier'; btn.disabled=false;
    }
  }

  function unlinkAthleteCode(){
    localStorage.removeItem('athlete_link_'+currentUser.username);
    athData = null;
    buildGenericDashboard();
  }

  async function buildCoachDashboard(){
    const u=currentUser,data=await loadCoachData(u.username);
    const g=data.groups,a=data.athletes;
    document.getElementById('panel-tableau-de-bord').innerHTML=`
      <div class="section-title">Tableau de bord</div>
      <div class="section-sub">Bonjour ${u.firstName} — gérez vos groupes et athlètes.</div>
      <div class="coach-dash">
        <div class="coach-section-header">
          <div class="coach-section-label">Groupes <span class="cs-count" id="count-groups">${g.length}</span></div>
          <button class="add-btn" onclick="openGroupModal()"><span class="plus">+</span> Créer un groupe</button>
        </div>
        <div class="groups-grid" id="groups-grid">${renderGroups(g)}</div>
        <div class="coach-section-header" style="margin-top:44px">
          <div class="coach-section-label">Athlètes individuels <span class="cs-count" id="count-athletes">${a.length}</span></div>
          <button class="add-btn" onclick="openAthleteModal()"><span class="plus">+</span> Ajouter un athlète</button>
        </div>
        <div class="athletes-grid" id="athletes-grid">${renderAthletes(a)}</div>
      </div>`;
  }

  function renderGroups(groups){
    if(!groups.length)return`<div class="empty-state"><div class="es-icon">👥</div>Aucun groupe pour l'instant.<br>Créez votre premier groupe !</div>`;
    return groups.map(g=>`
      <div class="group-card" style="--gc:${g.color}" onclick="openGroupDetail('${g.id}')">
        <div class="group-card-top">
          <span class="group-emoji">${g.emoji||'👥'}</span>
          <button class="group-card-delete" onclick="deleteGroup('${g.id}',event)" title="Supprimer">✕</button>
        </div>
        <div class="group-name">${g.name}</div>
        <div class="group-meta">
          <span class="group-dot"></span>
          ${(g.members||[]).length} membre${(g.members||[]).length!==1?'s':''} · ${g.createdAt}
        </div>
      </div>`).join('');
  }

  function renderAthletes(athletes){
    if(!athletes.length)return`<div class="empty-state"><div class="es-icon">⚡</div>Aucun athlète en suivi individuel.<br>Ajoutez votre premier athlète !</div>`;
    return athletes.map(a=>`
      <div class="athlete-card" onclick="openAthleteDetail('${a.id}')">
        <button class="athlete-card-delete" onclick="deleteAthlete('${a.id}',event)" title="Supprimer">✕</button>
        <div class="athlete-avatar">${a.firstName[0].toUpperCase()}</div>
        <div class="athlete-name">${a.firstName} ${a.lastName}</div>
        <div class="athlete-sport">${a.sport||'—'}</div>
      </div>`).join('');
  }

  async function refreshCoachUI(){
    const data=await loadCoachData(currentUser.username);
    const gg=document.getElementById('groups-grid');
    const ag=document.getElementById('athletes-grid');
    if(!gg||!ag){
      // Dashboard elements not rendered yet — rebuild fully
      loadDashboard(); return;
    }
    gg.innerHTML=renderGroups(data.groups);
    ag.innerHTML=renderAthletes(data.athletes);
    const cg=document.getElementById('count-groups');
    const ca=document.getElementById('count-athletes');
    if(cg) cg.textContent=data.groups.length;
    if(ca) ca.textContent=data.athletes.length;
  }

  /* ── GROUP DETAIL PANEL ── */
  async function openGroupDetail(groupId){
    const data=await loadCoachData(currentUser.username);
    const g=data.groups.find(x=>x.id===groupId);
    if(!g)return;
    activeGroupId=groupId;

    // Set CSS color variable on panel
    const panel=document.getElementById('group-detail-panel');
    panel.style.setProperty('--gd-color',g.color);

    // Stripe
    document.getElementById('gdp-stripe').style.background=g.color;

    // Nav
    document.getElementById('gdp-emoji-sm').textContent=g.emoji||'👥';
    document.getElementById('gdp-nav-name').textContent=g.name;

    // Header
    document.getElementById('gdp-big-emoji').textContent=g.emoji||'👥';
    document.getElementById('gdp-group-name').textContent=g.name;
    document.getElementById('gdp-group-date').textContent='Créé le '+g.createdAt;
    document.getElementById('gdp-color-dot').style.background=g.color;

    // Members modal subtitle
    document.getElementById('mgm-sub').textContent=`Ajoutez un athlète au groupe "${g.name}"`;

    renderGroupDetail(g);
    panel.classList.add('open');
    // prevent body scroll
    document.getElementById('screen-dashboard').style.overflow='hidden';
  }

  function renderGroupDetail(g){
    const members=g.members||[];
    document.getElementById('gdp-stat-members').textContent=members.length;
    document.getElementById('gdp-count').textContent=members.length;
    if(!members.length){
      document.getElementById('gdp-members-list').innerHTML=`<div class="empty-state"><div class="es-icon">👤</div>Aucun athlète dans ce groupe.<br>Ajoutez votre premier membre !</div>`;
      return;
    }
    document.getElementById('gdp-members-list').innerHTML=members.map((m,i)=>`
      <div class="member-row" style="animation-delay:${i*0.04}s">
        <div class="member-row-avatar">${m.firstName[0].toUpperCase()}</div>
        <div class="member-row-info">
          <div class="member-row-name">${m.firstName} ${m.lastName}</div>
          <div class="member-row-sport">${m.sport||'—'}</div>
        </div>
        <div class="member-row-date">${m.addedAt||''}</div>
        <button class="member-row-delete" onclick="deleteMember('${m.id}')" title="Retirer">✕</button>
      </div>`).join('');
  }

  function closeGroupDetail(){
    document.getElementById('group-detail-panel').classList.remove('open');
    document.getElementById('screen-dashboard').style.overflow='';
    activeGroupId=null;
    refreshCoachUI();
  }

  /* ── MODAL: AJOUTER MEMBRE AU GROUPE ── */
  function openGroupMemberModal(){
    ['mgm-first','mgm-last','mgm-sport'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('modal-group-member').classList.add('open');
  }

  async function confirmGroupMember(){
    const first=document.getElementById('mgm-first').value.trim();
    const last=document.getElementById('mgm-last').value.trim();
    const sport=document.getElementById('mgm-sport').value.trim();
    if(!first||!last)return;
    await sbFetch('group_members','POST',{group_id:activeGroupId,first_name:first,last_name:last,sport:sport||null});
    closeModal('modal-group-member');
    // reload group detail
    const data=await loadCoachData(currentUser.username);
    const g=data.groups.find(x=>x.id===activeGroupId);
    if(g){
      renderGroupDetail(g);
      document.getElementById('gdp-stat-members').textContent=g.members.length;
      document.getElementById('gdp-count').textContent=g.members.length;
    }
  }

  async function deleteMember(memberId){
    await sbFetch('group_members?id=eq.'+memberId,'DELETE');
    const data=await loadCoachData(currentUser.username);
    const g=data.groups.find(x=>x.id===activeGroupId);
    if(g) renderGroupDetail(g);
  }

  /* ── OTHER MODALS ── */
  function openGroupModal(){document.getElementById('mg-name').value='';document.getElementById('mg-emoji').value='';buildColorPicker();document.getElementById('modal-group').classList.add('open')}
  let selectedSexe=null;
  function openAthleteModal(){
    ['ma-first','ma-last','ma-age','ma-height','ma-weight','ma-sport'].forEach(i=>document.getElementById(i).value='');
    selectedSexe=null;
    ['sexe-m','sexe-f','sexe-a'].forEach(i=>document.getElementById(i).classList.remove('selected'));
    document.getElementById('modal-athlete').classList.add('open');
  }
  function selectSexe(v){
    selectedSexe=v;
    document.getElementById('sexe-m').classList.toggle('selected',v==='M');
    document.getElementById('sexe-f').classList.toggle('selected',v==='F');
    document.getElementById('sexe-a').classList.toggle('selected',v==='A');
  }
  function closeModal(id){document.getElementById(id).classList.remove('open')}
  document.addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))e.target.classList.remove('open')})

  function buildColorPicker(){
    selectedColor=GROUP_COLORS[0];
    document.getElementById('mg-color-picker').innerHTML=GROUP_COLORS.map((c,i)=>`<div class="color-dot${i===0?' selected':''}" style="background:${c}" onclick="selectColor('${c}',this)"></div>`).join('');
  }
  function selectColor(c,el){selectedColor=c;document.querySelectorAll('#mg-color-picker .color-dot').forEach(d=>d.classList.remove('selected'));el.classList.add('selected')}

  async function confirmGroup(){
    const name=document.getElementById('mg-name').value.trim();
    const emoji=document.getElementById('mg-emoji').value.trim()||'👥';
    if(!name)return;
    await sbFetch('groups','POST',{coach_username:currentUser.username,name,emoji,color:selectedColor});
    closeModal('modal-group');
    refreshCoachUI();
  }



  function copyAthleteCode(code){
    navigator.clipboard.writeText(code).then(()=>{
      const btn = document.querySelector('.athlete-code-copy');
      if(btn){ const orig=btn.textContent; btn.textContent='✓ Copié !'; setTimeout(()=>btn.textContent=orig,2000); }
    }).catch(()=>{});
  }
  function generateAthleteCode(){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  }
  async function confirmAthlete(){
    const first=document.getElementById('ma-first').value.trim();
    const last=document.getElementById('ma-last').value.trim();
    const age=document.getElementById('ma-age').value.trim();
    const height=document.getElementById('ma-height').value.trim();
    const weight=document.getElementById('ma-weight').value.trim();
    const sport=document.getElementById('ma-sport').value.trim();
    if(!first||!last){ showModalError('ma-error','Prénom et nom sont obligatoires.'); return; }
    const btn=document.querySelector('#modal-athlete .modal-confirm');
    const origTxt=btn.textContent;
    btn.textContent='⏳ Ajout...'; btn.disabled=true;
    const sexeLabel=selectedSexe==='M'?'Homme':selectedSexe==='F'?'Femme':selectedSexe==='A'?'Autre':null;
    try {
      const athleteCode = generateAthleteCode();
      const result = await sbFetch('athletes','POST',{
        coach_username:currentUser.username,
        first_name:first,last_name:last,
        age:age?parseInt(age):null,
        height:height?parseFloat(height):null,
        weight:weight?parseFloat(weight):null,
        sport:sport||null,
        sexe:sexeLabel,
        code:athleteCode
      });
      btn.textContent=origTxt; btn.disabled=false;
      closeModal('modal-athlete');
      await refreshCoachUI();
    } catch(err){
      btn.textContent=origTxt; btn.disabled=false;
      showModalError('ma-error','Erreur Supabase : '+err.message);
    }
  }

  function showModalError(elId, msg){
    let el=document.getElementById(elId);
    if(!el){
      el=document.createElement('div');
      el.id=elId;
      el.className='msg error';
      // insert before .modal-actions in modal-athlete
      const actions=document.querySelector('#modal-athlete .modal-actions');
      if(actions) actions.before(el);
      else document.body.appendChild(el);
    }
    el.textContent=msg;
    el.style.display='block';
    setTimeout(()=>{ if(el) el.style.display='none'; }, 6000);
  }

  async function deleteGroup(id,e){
    e.stopPropagation();
    await sbFetch('groups?id=eq.'+id,'DELETE');
    refreshCoachUI();
  }

  async function deleteAthlete(id,e){
    e.stopPropagation();
    await sbFetch('athletes?id=eq.'+id,'DELETE');
    refreshCoachUI();
  }


  /* ── ATHLETE DETAIL PANEL ── */

  /* ══ POLLING COMPLETIONS (vue coach) ══ */
  let _compPollTimer = null;

  async function refreshCompletionBadge(){
    if(!activeAthleteId) return;
    try {
      const rows = await sbFetch('seance_completions?athlete_id=eq.'+activeAthleteId+'&select=*&order=completed_at.desc');
      // Calcul semaine courante en heure locale
      const _now = new Date();
      const _dow = _now.getDay(); // 0=dim
      const _diffToMon = (_dow === 0) ? -6 : 1 - _dow;
      const weekStart = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate() + _diffToMon);
      const weekKeys = Array.from({length:7},(_,i)=>{
        const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()+i);
        return dateToKey(d);
      });
      const weekComps = (rows||[]).filter(r=>weekKeys.includes(r.schedule_date));
      // Compter uniquement les séances réellement programmées cette semaine
      // (une séance peut être dans la table mais plus dans le planning)
      let count = weekComps.length;
      if(window._lastCoachData){
        const athlete = window._lastCoachData.athletes.find(a=>a.id===activeAthleteId);
        if(athlete){
          const schedule = athlete.schedule || {};
          // Construire le set des seance_id+date réellement planifiées cette semaine
          const plannedSet = new Set();
          weekKeys.forEach(key=>{
            (schedule[key]||[]).forEach(slot=>plannedSet.add(slot.sid+'|'+key));
          });
          // Compter uniquement les completions qui correspondent à une séance planifiée
          count = weekComps.filter(r=>plannedSet.has(r.seance_id+'|'+r.schedule_date)).length;
        }
      }

      // Badge header — toujours recalculé depuis rows frais
      const compBadge = document.getElementById('adp-comp-badge');
      if(compBadge){
        compBadge.innerHTML = count
          ? `<span class="completion-badge">✓ ${count} séance${count>1?'s':''} complétée${count>1?'s':''} cette semaine</span>`
          : `<span class="completion-badge none">Aucune séance complétée cette semaine</span>`;
      }

      // Mettre à jour athlete.completions dans _lastCoachData et re-render la grille
      if(window._lastCoachData){
        const athlete = window._lastCoachData.athletes.find(a=>a.id===activeAthleteId);
        if(athlete){
          athlete.completions = rows||[];
          // Re-render le planning inline du panneau athlète
          const iwGrid = document.getElementById('iw-grid');
          if(iwGrid) renderInlineWeek(athlete);
        }
      }

      // Détail liste séances avec coches
      renderCoachCompletionList(rows||[]);
    } catch(e){}
  }

  function renderCoachCompletionList(completions){
    const el = document.getElementById('adp-completion-list');
    if(!el) return;
    if(!completions.length){
      el.innerHTML = `<div style="font-size:12px;color:rgba(240,236,228,.25);padding:8px 0">Aucune séance complétée pour l'instant.</div>`;
      return;
    }
    // Grouper par date
    const byDate = {};
    completions.forEach(r=>{
      if(!byDate[r.schedule_date]) byDate[r.schedule_date]=[];
      byDate[r.schedule_date].push(r);
    });
    const DAYS=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    const MONTHS=['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
    el.innerHTML = Object.entries(byDate)
      .sort(([a],[b])=>b.localeCompare(a))
      .slice(0,10)
      .map(([date, comps])=>{
        const d=keyToDate(date);
        const label=DAYS[d.getDay()]+' '+d.getDate()+' '+MONTHS[d.getMonth()];
        const items = comps.map(r=>{
          const t=new Date(r.completed_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
          return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">
            <span style="color:#2ec4b6;font-size:14px">✓</span>
            <span style="flex:1;font-size:12px;color:rgba(240,236,228,.7)" id="compseance-${r.seance_id}">${r.seance_id}</span>
            <span style="font-size:11px;color:rgba(240,236,228,.25)">${t}</span>
          </div>`;
        }).join('');
        return `<div style="margin-bottom:12px">
          <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,236,228,.3);margin-bottom:4px">${label}</div>
          ${items}
        </div>`;
      }).join('');

    // Remplacer les IDs de séances par leurs titres
    completions.forEach(r=>{
      const el2 = document.getElementById('compseance-'+r.seance_id);
      if(!el2) return;
      // Chercher dans les séances chargées
      const data = window._lastCoachData;
      if(data){
        const athlete = data.athletes.find(a=>a.id===activeAthleteId);
        const seance = athlete?.seances?.find(s=>s.id===r.seance_id);
        if(seance) el2.textContent = seance.title||'Séance';
      }
    });
  }

  function startCompPolling(){
    stopCompPolling();
    refreshCompletionBadge();
    _compPollTimer = setInterval(refreshCompletionBadge, 3000); // toutes les 3s
  }

  function stopCompPolling(){
    if(_compPollTimer){ clearInterval(_compPollTimer); _compPollTimer=null; }
  }

  let activeAthleteId=null;

  async function openAthleteDetail(athleteId){
    const data=await loadCoachData(currentUser.username);
    const a=data.athletes.find(x=>x.id===athleteId);
    if(!a)return;
    activeAthleteId=athleteId;

    document.getElementById('adp-nav-name').textContent=a.firstName+' '+a.lastName;
    document.getElementById('adp-avatar').textContent=a.firstName[0].toUpperCase();
    document.getElementById('adp-name').textContent=a.firstName+' '+a.lastName;
    document.getElementById('adp-sport').textContent=a.sport||'Sport non renseigné';
    // Badge complétion dans la semaine courante
    const todayKey = dateToKey(new Date());
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate()-(weekStart.getDay()||7)+1); weekStart.setHours(0,0,0,0);
    const weekKeys = Array.from({length:7},(_,i)=>{ const d=new Date(weekStart); d.setDate(weekStart.getDate()+i); return dateToKey(d); });
    const weekComps = (a.completions||[]).filter(r=>weekKeys.includes(r.schedule_date));
    const compBadge = document.getElementById('adp-comp-badge') || (() => {
      const b=document.createElement('div'); b.id='adp-comp-badge';
      b.style='margin-top:6px';
      document.getElementById('adp-sport').after(b); return b;
    })();
    compBadge.innerHTML = weekComps.length
      ? `<span class="completion-badge">✓ ${weekComps.length} séance${weekComps.length>1?'s':''} complétée${weekComps.length>1?'s':''} cette semaine</span>`
      : `<span class="completion-badge none">Aucune séance complétée cette semaine</span>`;

    // Générer un code si l'athlète n'en a pas
    if(!a.code){
      a.code = generateAthleteCode();
      sbFetch('athletes?id=eq.'+a.id,'PATCH',{code:a.code}).catch(()=>{});
    }

    renderCoachAthleteProfile(a, false);

    // Load seances + inline week + tests
    iwOffset = 0;
    renderSeances(a.seances||[], a);
    renderInlineWeek(a);
    renderTests(a.tests||[]);
    // Reset to first tab
    switchAthleteTab('seances', document.querySelector('.adp-tab'));

    document.getElementById('athlete-detail-panel').classList.add('open');
    document.getElementById('screen-dashboard').style.overflow='hidden';
    startCompPolling();
  }


  /* ── PROFIL ATHLÈTE (vue coach) éditable ── */
  let _coachEditAthleteData = null;

  function renderCoachAthleteProfile(a, editMode){
    _coachEditAthleteData = a;
    _editProfilSexe = a.sexe||null;
    const fields=[
      {label:'Prénom',value:a.firstName||'—'},
      {label:'Nom',value:a.lastName||'—'},
      {label:'Sport',value:a.sport||'—'},
      {label:'Âge',value:a.age?a.age+' ans':'—'},
      {label:'Taille',value:a.height?a.height+' cm':'—'},
      {label:'Poids',value:a.weight?a.weight+' kg':'—'},
      {label:'Sexe',value:a.sexe||'—'},
      {label:'Ajouté le',value:a.createdAt||'—'},
    ];
    const codeHtml = `<div class="athlete-code-card" style="margin-bottom:20px">
      <div class="athlete-code-left">
        <div class="athlete-code-label">Code de synchronisation</div>
        <div class="athlete-code-value">${a.code||'—'}</div>
        <div class="athlete-code-sub">L'athlète entre ce code dans son espace</div>
      </div>
      <button class="athlete-code-copy" onclick="copyAthleteCode('${a.code||''}')">📋 Copier</button>
    </div>`;
    const gridHtml = `<div class="ath-profil-grid" style="margin-top:0">
      ${fields.map(f=>`<div class="ath-profil-card"><div class="ath-profil-label">${f.label}</div><div class="ath-profil-value">${escHtml(String(f.value))}</div></div>`).join('')}
    </div>`;
    const editHtml = editMode
      ? buildProfilEditHtml({firstName:a.firstName,lastName:a.lastName,sport:a.sport,age:a.age,height:a.height,weight:a.weight,sexe:a.sexe}, 'coachSaveAthleteProfile','coachCancelAthleteProfile', false)
      : `<button style="margin-top:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 18px;color:rgba(240,236,228,.4);font-size:12px;font-weight:600;letter-spacing:.05em;cursor:pointer;transition:all .2s" onmouseover="this.style.background='rgba(255,255,255,.09)';this.style.color='rgba(240,236,228,.75)'" onmouseout="this.style.background='rgba(255,255,255,.04)';this.style.color='rgba(240,236,228,.4)'" onclick="renderCoachAthleteProfile(_coachEditAthleteData, true)">✏️ Modifier le profil</button>`;
    // Section identifiant athlète
    const usernameHtml = `<div id="coach-athlete-username-wrap" style="margin-top:14px"></div>`;
    document.getElementById('adp-profile-grid').innerHTML = codeHtml + gridHtml + editHtml + usernameHtml;
    renderAthleteUsernameEdit(false);
  }


  /* ══ MODIFICATION IDENTIFIANT ATHLÈTE (vue coach) ══ */
  function renderAthleteUsernameEdit(open){
    const wrap = document.getElementById('coach-athlete-username-wrap');
    if(!wrap || !_coachEditAthleteData) return;
    const a = _coachEditAthleteData;
    const cur = a.athleteUsername || '';

    if(!open){
      wrap.innerHTML = `
        <div style="padding:14px 0;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;gap:14px">
          <div style="flex:1;min-width:0">
            <div style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:rgba(240,236,228,.3);margin-bottom:5px">Identifiant de connexion</div>
            <div style="font-size:15px;font-weight:600;color:${cur ? 'var(--white)' : 'rgba(240,236,228,.25)'}">
              ${cur ? escHtml(cur) : 'Non défini — cliquez Modifier pour en créer un'}
            </div>
          </div>
          <button class="username-open-btn" onclick="renderAthleteUsernameEdit(true)">✏️ Modifier</button>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div style="padding-top:14px;border-top:1px solid rgba(255,255,255,.07)">
        <div class="username-edit-box">
          <div class="username-edit-title">Identifiant de connexion de l'athlète</div>
          <div class="username-edit-row">
            <div class="username-edit-field">
              <span class="username-edit-label">Identifiant</span>
              <input class="username-edit-input" id="ath-username-input"
                type="text" value="${escHtml(cur)}"
                placeholder="Ex : enzo.thevenaud…"
                autocomplete="off"/>
            </div>
            <button class="username-save-btn" onclick="saveAthleteUsername()">Enregistrer</button>
          </div>
          <div class="username-edit-msg" id="ath-username-msg"></div>
          <div style="display:flex;gap:14px;margin-top:6px;align-items:center">
            <button style="background:none;border:none;color:rgba(240,236,228,.3);font-size:12px;cursor:pointer;padding:0" onclick="renderAthleteUsernameEdit(false)">Annuler</button>
            ${cur ? '<button style="background:none;border:none;color:rgba(230,57,70,.5);font-size:12px;cursor:pointer;padding:0" onmouseover="this.style.color=\'#e63946\'" onmouseout="this.style.color=\'rgba(230,57,70,.5)\'" onclick="deleteAthleteUsername()">🗑 Supprimer l\'identifiant</button>' : ''}
          </div>
        </div>
      </div>`;
    setTimeout(()=>{ const i=document.getElementById('ath-username-input'); if(i) i.focus(); },50);
  }

  async function saveAthleteUsername(){
    const a = _coachEditAthleteData;
    if(!a) return;
    const input = document.getElementById('ath-username-input');
    const msg = document.getElementById('ath-username-msg');
    const oldUsername = a.athleteUsername || '';
    const newUsername = (input?.value||'').trim().toLowerCase();

    if(!newUsername){ msg.textContent='Entrez un identifiant.'; msg.className='username-edit-msg err'; return; }
    if(newUsername.length < 3){ msg.textContent='Minimum 3 caractères.'; msg.className='username-edit-msg err'; return; }
    if(newUsername === oldUsername){ msg.textContent="C'est déjà l'identifiant actuel."; msg.className='username-edit-msg err'; return; }

    const btn = document.querySelector('#coach-athlete-username-wrap .username-save-btn');
    btn.textContent='⏳'; btn.disabled=true;

    try {
      const existing = await sbFetch('users?username=eq.'+encodeURIComponent(newUsername)+'&select=id');
      if(existing && existing.length){
        msg.textContent='Cet identifiant est déjà utilisé.'; msg.className='username-edit-msg err';
        btn.textContent='Enregistrer'; btn.disabled=false; return;
      }

      if(oldUsername){
        await sbFetch('users?username=eq.'+encodeURIComponent(oldUsername), 'PATCH', {username: newUsername, first_name: a.firstName, last_name: a.lastName});
      } else {
        await sbFetch('users', 'POST', {username: newUsername, password: newUsername, first_name: a.firstName, last_name: a.lastName, role: 'athlete'});
      }

      await sbFetch('athletes?id=eq.'+a.id, 'PATCH', {athlete_username: newUsername});
      _coachEditAthleteData.athleteUsername = newUsername;

      msg.textContent='✓ Identifiant mis à jour !'; msg.className='username-edit-msg ok';
      btn.textContent='Enregistrer'; btn.disabled=false;
      setTimeout(()=>renderAthleteUsernameEdit(false), 1400);
    } catch(err){
      msg.textContent='Erreur : '+err.message; msg.className='username-edit-msg err';
      btn.textContent='Enregistrer'; btn.disabled=false;
    }
  }

  async function deleteAthleteUsername(){
    const a = _coachEditAthleteData;
    if(!a || !a.athleteUsername) return;
    if(!confirm("Supprimer l'identifiant de connexion de cet athlète ? L'identifiant sera libéré et pourra être réutilisé.")) return;
    try {
      await sbFetch('users?username=eq.'+encodeURIComponent(a.athleteUsername), 'DELETE');
      await sbFetch('athletes?id=eq.'+a.id, 'PATCH', {athlete_username: null});
      _coachEditAthleteData.athleteUsername = null;
      renderAthleteUsernameEdit(false);
    } catch(err){ console.error('deleteAthleteUsername:', err); }
  }

  function coachCancelAthleteProfile(){ renderCoachAthleteProfile(_coachEditAthleteData, false); }

  async function coachSaveAthleteProfile(){
    const a = _coachEditAthleteData;
    if(!a) return;
    const vals = getProfilEditValues();
    if(!vals.first_name) return;
    const btn = document.querySelector('#adp-panel-profil .profil-save-btn');
    if(btn){ btn.textContent='⏳'; btn.disabled=true; }
    try {
      await sbFetch('athletes?id=eq.'+a.id, 'PATCH', vals);
      // Refresh athlete data
      const {data, athlete} = await getAthleteData();
      if(athlete){
        _coachEditAthleteData = {
          ...athlete,
          firstName: vals.first_name||athlete.firstName,
          lastName: vals.last_name||athlete.lastName,
          sport: vals.sport,
          age: vals.age,
          height: vals.height,
          weight: vals.weight,
          sexe: vals.sexe,
        };
        // Màj header panneau
        document.getElementById('adp-name').textContent = _coachEditAthleteData.firstName+' '+_coachEditAthleteData.lastName;
        document.getElementById('adp-sport').textContent = _coachEditAthleteData.sport||'Sport non renseigné';
        renderCoachAthleteProfile(_coachEditAthleteData, false);
        // Refresh dashboard coach
        refreshCoachUI();
      }
    } catch(err){
      if(btn){ btn.textContent='✓ Enregistrer'; btn.disabled=false; }
      console.error('coachSaveAthleteProfile:', err);
    }
  }

  function closeAthleteDetail(){
    stopCompPolling();
    document.getElementById('athlete-detail-panel').classList.remove('open');
    document.getElementById('screen-dashboard').style.overflow='';
    activeAthleteId=null;
  }

  function switchAthleteTab(name, btn){
    document.querySelectorAll('.adp-panel').forEach(p=>p.classList.remove('active'));
    document.getElementById('adp-panel-'+name).classList.add('active');
    document.querySelectorAll('.adp-tab').forEach(t=>t.classList.remove('active'));
    if(btn)btn.classList.add('active');
  }


  /* ══ SÉANCES ══ */
  let seanceChooserOpen = false;

  function toggleSeanceChooser(e){
    e.stopPropagation();
    seanceChooserOpen = !seanceChooserOpen;
    document.getElementById('seance-type-dropdown').classList.toggle('open', seanceChooserOpen);
  }
  document.addEventListener('click', e => {
    if(seanceChooserOpen && !e.target.closest('#seance-type-chooser')){
      seanceChooserOpen = false;
      const dd = document.getElementById('seance-type-dropdown');
      if(dd) dd.classList.remove('open');
    }
  });

  async function createSeance(type){
    seanceChooserOpen = false;
    document.getElementById('seance-type-dropdown').classList.remove('open');
    if(type === 'ligne'){
      document.getElementById('lm-title').value = '';
      document.getElementById('lm-content').value = '';
      initSeanceColorPicker('lm-color-picker', null);
      document.getElementById('ligne-modal-overlay').classList.add('open');
      return;
    }
    // block type: ouvrir la modale de configuration
    openBlockModal();
  }

  function closeLigneModal(){
    document.getElementById('ligne-modal-overlay').classList.remove('open');
  }

  async function saveLigneModal(){
    const title = document.getElementById('lm-title').value.trim() || 'Séance libre';
    const content = document.getElementById('lm-content').value;
    const color = selectedSeanceColor || SEANCE_COLORS[0];
    await sbFetch('seances','POST',{athlete_id:activeAthleteId, type:'ligne', title, content, color});
    const {data,athlete}=await getAthleteData();
    closeLigneModal();
    renderSeances(athlete.seances, athlete);
  }

  function renderSeances(seances, athlete){
    const list = document.getElementById('seances-list');
    if(!seances || !seances.length){
      list.innerHTML = `<div class="adp-empty"><div class="adp-empty-icon">🏋️</div><div class="adp-empty-title">Aucune séance</div>Cliquez sur "+ Ajouter une séance" pour commencer.</div>`;
      return;
    }

    // Calculer les clés de la semaine visible dans le mini planning
    const weekDays = getWeekDays(iwOffset);
    const weekKeys = new Set(weekDays.map(d => dateToKey(d)));

    // Construire un map sid → dates programmées cette semaine
    const schedule = athlete ? (athlete.schedule || {}) : {};
    const scheduledDates = {}; // sid → [dateKey, ...]
    Object.entries(schedule).forEach(([dateKey, slots]) => {
      if(!weekKeys.has(dateKey)) return;
      slots.forEach(slot => {
        if(!scheduledDates[slot.sid]) scheduledDates[slot.sid] = [];
        scheduledDates[slot.sid].push(dateKey);
      });
    });

    const DAYS_FR_SHORT = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    const fmt = dateKey => {
      const d = keyToDate(dateKey);
      return DAYS_FR_SHORT[d.getDay()] + ' ' + d.getDate();
    };

    list.innerHTML = seances.map((s,i) => {
      const dates = scheduledDates[s.id] || [];
      const scheduledBadges = dates.map(dk =>
        `<span class="seance-scheduled-badge">📅 ${fmt(dk)}</span>`
      ).join('');

      return `
      <div class="seance-card" id="sc-${s.id}" style="animation-delay:${i*0.05}s;border-left-color:${s.color||'#2ec4b6'}">
        <div class="seance-card-header" onclick="toggleSeanceCard('${s.id}')">
          <div class="seance-card-left">
            <span class="seance-type-badge ${s.type}">${s.type === 'ligne' ? 'Ligne' : 'Block'}</span>
            <div class="seance-card-color-dot" style="background:${s.color||'#2ec4b6'}"></div>
            <span class="seance-card-title">${escHtml(s.title)}</span>
            ${scheduledBadges}
          </div>
          <div class="seance-card-right">
            <span class="seance-card-date">${s.date}</span>
            <button class="seance-action-btn" title="Options" onclick="openSeanceActionMenu(event,'${s.id}')">+</button>
            <span class="seance-chevron">▼</span>
          </div>
        </div>
        <div class="seance-card-body">
          ${s.type === 'ligne' ? renderLigneBody(s) : renderBlockBody(s)}
        </div>
      </div>`;
    }).join('');
  }

  async function refreshInlineWeek(){
    const iw = document.getElementById('iw-grid');
    if(!iw) return;
    const {data,athlete} = await getAthleteData();
    if(athlete) renderInlineWeek(athlete);
  }

  function escHtml(t){ return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function renderLigneBody(s){
    const lines = escHtml(s.content||'').replace(/\n/g,'<br>') || '<em style="color:rgba(240,236,228,.25)">Aucun contenu.</em>';
    return `
      <div style="margin-top:14px;font-size:14px;color:rgba(240,236,228,.7);line-height:1.8;white-space:pre-wrap">${lines}</div>`;
  }

  function renderBlockBody(s){
    const circuits = s.content || [];

    // Badge RPE
    const rpeColor = s.rpe!=null ? RPE_COLORS[s.rpe] : '#2ec4b6';
    const rpeHtml = s.rpe!=null ? `
      <div class="block-rpe-badge">
        <span style="font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(240,236,228,.3)">RPE</span>
        <span style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:${rpeColor};line-height:1">${s.rpe}</span>
        <span style="font-size:12px;color:${rpeColor}">${RPE_LABELS[s.rpe]||''}</span>
      </div>` : '';

    // Tous les blocks affichés d'un coup
    const blocksHtml = circuits.map((circ, ci) => {
      const exercises = circ.exercises || [];
      // Nom du block + nb séries
      const blockName = circ.name || (circuits.length > 1 ? `Block ${ci+1}` : 'Exercices');
      const seriesLabel = circ.series ? ` — ${circ.series} série${parseInt(circ.series)>1?'s':''}` : '';
      const label = escHtml(blockName) + seriesLabel;

      const exHtml = exercises.length
        ? exercises.map((ex, ei) => {
            const e = typeof ex === 'object' ? ex : {name: ex||'', reps:'', intensity:''};
            const tags = [
              e.reps ? `<span class="block-read-tag reps">${escHtml(e.reps)} rép.</span>` : '',
              e.intensity ? `<span class="block-read-tag intensity">${escHtml(e.intensity)}</span>` : '',
            ].filter(Boolean).join('');
            const videoLink = e.url ? `<a class="block-read-video-link" href="${escHtml(e.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">▶ Vidéo</a>` : '';
            return `
              <div class="block-read-exercise">
                <span class="block-read-ex-num">${ei+1}</span>
                <span class="block-read-ex-name">${escHtml(e.name||'—')}</span>
                ${e.reps ? `<span class="block-read-sep">|</span><span class="block-read-tag reps">${escHtml(e.reps)}</span>` : ''}
                ${e.intensity ? `<span class="block-read-sep">|</span><span class="block-read-tag intensity">${escHtml(e.intensity)}</span>` : ''}
                ${videoLink}
              </div>`;
          }).join('')
        : `<div class="block-read-empty">Aucun exercice.</div>`;

      return `
        <div class="block-read-section">
          <div class="block-read-label">${label}</div>
          ${exHtml}
        </div>`;
    }).join('');

    if(!circuits.length) return `
      <div style="padding:16px 0;color:rgba(240,236,228,.25);font-size:13px;font-style:italic">
        Aucun block défini.
      </div>`;

    return `
      <div style="padding-top:14px">
        ${rpeHtml}
        ${blocksHtml}
      </div>`;
  }

  function toggleSeanceCard(id){
    document.getElementById('sc-'+id).classList.toggle('expanded');
  }

  async function getAthleteData(){
    const data = await loadCoachData(currentUser.username);
    return { data, athlete: data.athletes.find(x=>x.id===activeAthleteId) };
  }

  async function updateSeanceTitle(sid, val){
    await sbFetch('seances?id=eq.'+sid,'PATCH',{title:val});
    const card = document.getElementById('sc-'+sid);
    if(card) card.querySelector('.seance-card-title').textContent = val;
  }

  async function updateLigneContent(sid, val){
    await sbFetch('seances?id=eq.'+sid,'PATCH',{content:val});
  }

  async function addCircuit(sid){
    const rows=await sbFetch('seances?id=eq.'+sid+'&select=content');
    const content=rows&&rows[0]?rows[0].content||[]:[];
    content.push({name:'',exercises:[]});
    await sbFetch('seances?id=eq.'+sid,'PATCH',{content});
    const {data,athlete}=await getAthleteData();
    renderSeances(athlete.seances, athlete);
    setTimeout(()=>{const card=document.getElementById('sc-'+sid);if(card&&!card.classList.contains('expanded'))card.classList.add('expanded');},50);
  }

  async function deleteCircuit(sid, ci){
    const rows=await sbFetch('seances?id=eq.'+sid+'&select=content');
    const content=rows&&rows[0]?rows[0].content||[]:[];
    content.splice(ci,1);
    await sbFetch('seances?id=eq.'+sid,'PATCH',{content});
    const {data,athlete}=await getAthleteData();
    renderSeances(athlete.seances, athlete);
    setTimeout(()=>{const card=document.getElementById('sc-'+sid);if(card)card.classList.add('expanded');},50);
  }

  async function updateCircuitName(sid, ci, val){
    const rows=await sbFetch('seances?id=eq.'+sid+'&select=content');
    const content=rows&&rows[0]?rows[0].content||[]:[];
    if(content[ci]) content[ci].name=val;
    await sbFetch('seances?id=eq.'+sid,'PATCH',{content});
  }

  async function addExercise(sid, ci){
    const rows=await sbFetch('seances?id=eq.'+sid+'&select=content');
    const content=rows&&rows[0]?rows[0].content||[]:[];
    if(!content[ci]) return;
    content[ci].exercises.push('');
    await sbFetch('seances?id=eq.'+sid,'PATCH',{content});
    // Re-render juste le bloc concerné pour ne pas perdre le focus
    const {data,athlete}=await getAthleteData();
    const s = athlete.seances.find(x=>x.id===sid);
    if(!s) return;
    const exList = document.getElementById('exlist-'+sid+'-'+ci);
    if(exList){
      const exercises = (s.content[ci]||{}).exercises||[];
      exList.innerHTML = exercises.map((ex,ei)=>`
        <div class="exercise-row">
          <span class="exercise-num">${ei+1}</span>
          <input class="exercise-input" value="${escHtml(ex)}"
            placeholder="Exercice, séries × reps, charge…"
            oninput="updateExercise('${sid}',${ci},${ei},this.value)"/>
          <button class="exercise-remove" onclick="deleteExercise('${sid}',${ci},${ei})">✕</button>
        </div>`).join('');
      // Focus sur le dernier input
      const inputs = exList.querySelectorAll('.exercise-input');
      if(inputs.length) inputs[inputs.length-1].focus();
      // Mettre à jour le compteur
      const prog = exList.closest('.block-panel');
      if(prog){
        const counter = prog.querySelector('.block-progress');
        if(counter) counter.textContent = exercises.length+' exercice'+(exercises.length!==1?'s':'');
      }
    } else {
      renderSeances(athlete.seances, athlete);
      setTimeout(()=>{const card=document.getElementById('sc-'+sid);if(card)card.classList.add('expanded');},50);
    }
  }

  async function deleteExercise(sid, ci, ei){
    const rows=await sbFetch('seances?id=eq.'+sid+'&select=content');
    const content=rows&&rows[0]?rows[0].content||[]:[];
    if(content[ci]) content[ci].exercises.splice(ei,1);
    await sbFetch('seances?id=eq.'+sid,'PATCH',{content});
    const {data,athlete}=await getAthleteData();
    renderSeances(athlete.seances, athlete);
    setTimeout(()=>{const card=document.getElementById('sc-'+sid);if(card)card.classList.add('expanded');},50);
  }

  async function updateExercise(sid, ci, ei, val){
    const rows=await sbFetch('seances?id=eq.'+sid+'&select=content');
    const content=rows&&rows[0]?rows[0].content||[]:[];
    if(content[ci]) content[ci].exercises[ei]=val;
    await sbFetch('seances?id=eq.'+sid,'PATCH',{content});
  }

  async function deleteSeance(sid, e){
    e.stopPropagation();
    await sbFetch('seances?id=eq.'+sid,'DELETE');
    const {data,athlete} = await getAthleteData();
    renderSeances(athlete.seances, athlete);
  }

  async function saveSeances(){
    // data is already saved on each input — just visual feedback
    const btn = event.currentTarget;
    const orig = btn.textContent;
    btn.textContent = '✓ Sauvegardé';
    btn.style.background = '#2ec4b6';
    setTimeout(()=>{ btn.textContent=orig; btn.style.background=''; }, 1800);
  }



  /* ══ PALETTE COULEURS SÉANCES ══ */
  const SEANCE_COLORS = [
    '#2ec4b6','#f4a261','#e63946','#a8dadc',
    '#6a4c93','#f9c74f','#90be6d','#f94144',
    '#277da1','#f3722c',
  ];
  let selectedSeanceColor = SEANCE_COLORS[0];

  function initSeanceColorPicker(pickerId, currentColor){
    const el = document.getElementById(pickerId);
    if(!el) return;
    selectedSeanceColor = currentColor || SEANCE_COLORS[0];
    el.innerHTML = SEANCE_COLORS.map(col => `
      <div class="cp-swatch${col===selectedSeanceColor?' selected':''}"
        style="background:${col}"
        onclick="pickSeanceColor('${col}','${pickerId}')">
      </div>`).join('');
  }

  function pickSeanceColor(col, pickerId){
    selectedSeanceColor = col;
    document.querySelectorAll('#'+pickerId+' .cp-swatch').forEach(s=>{
      s.classList.toggle('selected', s.style.background===col||s.style.backgroundColor===col);
    });
  }

  /* ══ MINI PLANNING INLINE ══ */
  let iwOffset = 0; // semaine courante = 0

  async function renderInlineWeek(athlete){
    // Charger completions fraîches
    let compMap = {};
    try {
      const rows = await sbFetch('seance_completions?athlete_id=eq.'+athlete.id+'&select=*');
      (rows||[]).forEach(r=>{ compMap[r.seance_id+'|'+r.schedule_date]={done:true,rpe:r.rpe_ressenti??null}; });
    } catch(e){}

    const days = getWeekDays(iwOffset);
    const DAYS_FR = ['L','M','M','J','V','S','D'];
    const today = new Date(); today.setHours(0,0,0,0);
    const fmt = d => d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'});
    const schedule = athlete.schedule || {};
    const placing = !!weekSeanceId;

    document.getElementById('iw-range').textContent = fmt(days[0])+' — '+fmt(days[6]);
    document.getElementById('iw-title').textContent = 'Semaine du '+fmt(days[0]);

    document.getElementById('iw-grid').innerHTML = days.map((d,i) => {
      const key = dateToKey(d);
      const isToday = d.getTime()===today.getTime();
      const slots = schedule[key]||[];

      const pillsHtml = slots.map(slot=>{
        const compEntry = compMap[slot.sid+'|'+key];
        const isComp = !!compEntry;
        const slotRpe = compEntry?.rpe ?? null;
        return `<div class="inline-pill${isComp?' completed':''}"
          style="border-left:3px solid ${slot.color||'#2ec4b6'};background:${isComp?'rgba(46,196,182,.12)':slot.color+'22'}"
          title="${escHtml(slot.title)}"
          onclick="openDayPageFromInline('${key}','${DAYS_FR[i]} ${d.getDate()}',event)">
          <span style="${isComp?'text-decoration:line-through;text-decoration-color:rgba(46,196,182,.7);color:rgba(240,236,228,.4)':''}">${escHtml(slot.title)}</span>
          ${isComp ? '<div style="font-size:8px;font-weight:700;color:#2ec4b6;margin-top:2px">✓ Complété'+(slotRpe!==null?' · RPE '+slotRpe:'')+'</div>' : ''}
        </div>`;
      }).join('');

      return `<div class="inline-day">
        <div class="inline-day-header${isToday?' today':''}"
          onclick="openDayPageFromInline('${key}','${DAYS_FR[i]} ${d.getDate()}',event)">
          <div class="inline-day-name">${DAYS_FR[i]}</div>
          <div class="inline-day-num">${d.getDate()}</div>
        </div>
        ${pillsHtml}
        <button class="inline-day-add${placing?' placing':''}"
          onclick="inlineDayAdd(event,'${key}')">
          ${placing?'＋':'＋'}
        </button>
      </div>`;
    }).join('');
  }

  function openDayPageFromInline(key, label, e){
    e.stopPropagation();
    if(weekSeanceId){ inlineDayAdd(e,key); return; }
    openDayPage(key, label);
  }

  async function inlineDayAdd(e, dateKey){
    e.stopPropagation();
    if(!weekSeanceId) return;
    await addSeanceToDay(dateKey);
    // re-render inline week after adding
    const {data,athlete} = await getAthleteData();
    renderInlineWeek(athlete);
  }

  async function shiftInlineWeek(dir){
    iwOffset += dir;
    const {data,athlete} = await getAthleteData();
    renderInlineWeek(athlete);
    renderSeances(athlete.seances, athlete); // màj badges semaine
  }


  /* ══ BLOCK MODAL MULTI-ÉTAPES ══ */
  const RPE_LABELS = ['Repos complet','Très facile','Facile','Modéré léger','Modéré','Modéré difficile','Difficile','Très difficile','Extrêmement difficile','Quasi-maximal','Maximal absolu'];
  const RPE_COLORS = ['#4ecca3','#4ecca3','#90be6d','#90be6d','#f9c74f','#f9c74f','#f3722c','#f3722c','#e63946','#e63946','#e63946'];

  // État de la modale
  let bmStep = 0;          // 0 = config, 1..N = blocks
  let bmNbBlocks = 1;
  let bmBlocks = [];       // [{name:'', exercises:[]}]
  let bmTitle = '';
  let bmColor = '';
  let bmRpe = 6;
  let bmEditingId = null;  // null = création, sinon ID de la séance à modifier

  function openBlockModal(){
    bmStep = 0;
    bmNbBlocks = 1;
    bmBlocks = [{name:'', series:'', exercises:[]}];
    bmTitle = '';
    bmColor = SEANCE_COLORS[1];
    bmRpe = 6;
    bmEditingId = null;
    selectedSeanceColor = bmColor;
    document.getElementById('block-modal-overlay').classList.add('open');
    bmRender();
  }

  function openBlockModalEdit(s){
    bmEditingId = s.id;
    bmStep = 0;
    const blocks = Array.isArray(s.content) ? s.content : [];
    bmNbBlocks = blocks.length || 1;
    // Normaliser les exercices (string → objet)
    bmBlocks = blocks.map(b => ({
      name: b.name || '',
      series: b.series || '',
      exercises: (b.exercises||[]).map(e =>
        typeof e === 'object' ? e : {name:e||'',reps:'',intensity:'',url:''}
      )
    }));
    if(!bmBlocks.length) bmBlocks = [{name:'',series:'',exercises:[]}];
    bmTitle = s.title || '';
    bmColor = s.color || SEANCE_COLORS[1];
    bmRpe = s.rpe ?? 6;
    selectedSeanceColor = bmColor;
    document.getElementById('block-modal-overlay').classList.add('open');
    bmRender();
  }

  function closeBlockModal(){
    document.getElementById('block-modal-overlay').classList.remove('open');
  }

  function bmRender(){
    const totalSteps = 1 + bmNbBlocks; // étape 0 = config, 1..N = blocks
    const isConfig = bmStep === 0;
    const blockIdx = bmStep - 1;
    const isLastBlock = bmStep === bmNbBlocks;

    // Indicateur d'étapes
    document.getElementById('bm-step-indicator').innerHTML =
      Array.from({length: totalSteps}, (_,i) =>
        `<div class="bm-step-dot${i===bmStep?' active':i<bmStep?' done':''}"></div>`
      ).join('');

    // Titre et sous-titre
    if(isConfig){
      document.getElementById('bm-modal-title').textContent = bmEditingId ? 'Modifier la séance' : 'Nouvelle séance — Block';
      document.getElementById('bm-modal-sub').textContent = bmEditingId ? 'Modifiez la configuration' : 'Configurez votre séance';
    } else {
      document.getElementById('bm-modal-title').textContent = bmTitle || 'Séance block';
      document.getElementById('bm-modal-sub').textContent =
        bmNbBlocks > 1 ? `Block ${blockIdx+1} sur ${bmNbBlocks}` : 'Ajoutez vos exercices';
    }

    // Boutons footer
    document.getElementById('bm-back-btn').style.display = bmStep > 0 ? '' : 'none';
    const nextBtn = document.getElementById('bm-next-btn');
    if(isLastBlock){
      nextBtn.textContent = bmEditingId ? '✓ Enregistrer' : '✓ Créer la séance';
      nextBtn.className = 'bm-next-btn done';
    } else {
      nextBtn.textContent = isConfig ? 'Remplir les blocks →' : `Block ${blockIdx+2} →`;
      nextBtn.className = 'bm-next-btn';
    }

    // Corps
    if(isConfig){
      bmRenderConfig();
    } else {
      bmRenderBlock(blockIdx);
    }
  }

  function bmRenderConfig(){
    const rpeColor = RPE_COLORS[bmRpe];
    document.getElementById('bm-body').innerHTML = `
      <div class="field-wrap">
        <label class="field-label">Nom de la séance</label>
        <input class="field-input" id="bm-title-input" type="text"
          value="${escHtml(bmTitle)}"
          placeholder="Ex : Force haut du corps, HIIT…"
          oninput="bmTitle=this.value"/>
      </div>

      <div class="field-wrap">
        <label class="field-label">Couleur</label>
        <div class="color-picker-row" id="bm-color-picker"></div>
      </div>

      <div class="field-wrap">
        <label class="field-label">Nombre de blocks</label>
        <div class="nb-block-row">
          ${[1,2,3,4,5].map(n=>`
            <button class="nb-block-btn${n===bmNbBlocks?' selected':''}"
              onclick="bmSelectNbBlock(${n})">${n}</button>`).join('')}
        </div>
      </div>

      <div class="field-wrap">
        <label class="field-label">RPE cible</label>
        <div class="rpe-display" id="bm-rpe-display" style="color:${rpeColor}">${bmRpe}</div>
        <div class="rpe-sub" id="bm-rpe-label" style="color:${rpeColor}">${RPE_LABELS[bmRpe]}</div>
        <input type="range" class="rpe-slider" id="bm-rpe-input"
          min="0" max="10" value="${bmRpe}"
          oninput="bmUpdateRpe(this.value)"
          style="background:linear-gradient(to right,${rpeColor} ${bmRpe*10}%,rgba(255,255,255,.1) ${bmRpe*10}%)"/>
        <div class="rpe-labels"><span>0 — Repos</span><span>5 — Modéré</span><span>10 — Max</span></div>
      </div>
    `;
    initSeanceColorPicker('bm-color-picker', bmColor);
    // Focus sur le titre
    setTimeout(()=>{ const t=document.getElementById('bm-title-input'); if(t) t.focus(); }, 50);
  }

  function bmRenderBlock(ci){
    const block = bmBlocks[ci] || {name:'', series:'', exercises:[]};
    const exHtml = block.exercises.map((ex, ei) => bmExRow(ci, ei, ex)).join('');

    document.getElementById('bm-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;margin-bottom:4px">
        <div class="field-wrap" style="margin:0">
          <label class="field-label">Nom du block</label>
          <input class="field-input" style="font-size:15px;font-weight:600"
            value="${escHtml(block.name||'')}"
            placeholder="Ex: Squat, Poussée, Tirage…"
            oninput="bmUpdateBlockName(${ci},this.value)"/>
        </div>
        <div class="field-wrap" style="margin:0;width:90px">
          <label class="field-label">Séries</label>
          <input class="field-input" type="text" style="text-align:center"
            value="${escHtml(block.series||'')}"
            placeholder="Ex: 4"
            oninput="bmUpdateBlockSeries(${ci},this.value)"/>
        </div>
      </div>

      <div style="height:1px;background:rgba(255,255,255,.06);margin:14px 0 12px"></div>

      <div id="bm-exlist-${ci}">${exHtml}</div>

      <button class="bm-add-exercise" onclick="bmAddExercise(${ci})" style="margin-top:6px">
        + Ajouter un exercice
      </button>
      <div class="bm-block-counter" id="bm-counter-${ci}" style="margin-top:8px">
        ${block.exercises.length} exercice${block.exercises.length!==1?'s':''}
      </div>
    `;
  }


  function bmExRow(ci, ei, ex){
    const e = typeof ex === 'object' ? ex : {name: ex||'', reps:'', intensity:'', url:''};
    return `
      <div class="bm-ex-card" id="bmex-${ci}-${ei}">
        <div class="bm-ex-card-header">
          <span class="bm-ex-card-num">${ei+1}</span>
          <input class="bm-ex-name-input"
            value="${escHtml(e.name||'')}"
            placeholder="Nom de l'exercice…"
            oninput="bmUpdateExName(${ci},${ei},this.value)"/>
          <span class="bm-ex-sep">|</span>
          <input class="bm-ex-sub-input reps"
            type="text"
            value="${escHtml(e.reps||'')}"
            placeholder="Reps"
            title="Répétitions"
            oninput="bmUpdateExReps(${ci},${ei},this.value)"/>
          <input class="bm-ex-sub-input intensity"
            type="text"
            value="${escHtml(e.intensity||'')}"
            placeholder="Intensité (%, RIR, RPE…)"
            title="Intensité"
            oninput="bmUpdateExIntensity(${ci},${ei},this.value)"/>
          <button class="bm-ex-remove" onclick="bmRemoveExercise(${ci},${ei})">✕</button>
        </div>
        <input class="bm-ex-url-input"
          type="url"
          value="${escHtml(e.url||'')}"
          placeholder="🎥  Lien vidéo (YouTube, Instagram…)"
          oninput="bmUpdateExUrl(${ci},${ei},this.value)"/>
      </div>`;
  }
  function bmSelectNbBlock(n){
    bmNbBlocks = n;
    // Ajuster bmBlocks
    while(bmBlocks.length < n) bmBlocks.push({name:'', series:'', exercises:[]});
    bmBlocks = bmBlocks.slice(0, n);
    // Re-render juste les boutons
    [1,2,3,4,5].forEach(i => {
      const btn = document.querySelector(`.nb-block-btn:nth-child(${i})`);
    });
    document.querySelectorAll('.nb-block-btn').forEach((btn, i) => {
      btn.classList.toggle('selected', i+1 === n);
    });
  }

  function bmUpdateRpe(val){
    bmRpe = parseInt(val);
    const color = RPE_COLORS[bmRpe];
    const disp = document.getElementById('bm-rpe-display');
    const label = document.getElementById('bm-rpe-label');
    const slider = document.getElementById('bm-rpe-input');
    if(disp){ disp.textContent = bmRpe; disp.style.color = color; }
    if(label){ label.textContent = RPE_LABELS[bmRpe]; label.style.color = color; }
    if(slider) slider.style.background =
      `linear-gradient(to right,${color} ${bmRpe*10}%,rgba(255,255,255,.1) ${bmRpe*10}%)`;
  }

  function bmUpdateBlockName(ci, val){ if(bmBlocks[ci]) bmBlocks[ci].name = val; }
  function bmUpdateBlockSeries(ci, val){ if(bmBlocks[ci]) bmBlocks[ci].series = val; }
  function bmUpdateExName(ci, ei, val){ if(bmBlocks[ci]&&bmBlocks[ci].exercises[ei]) bmBlocks[ci].exercises[ei].name = val; }
  function bmUpdateExReps(ci, ei, val){ if(bmBlocks[ci]&&bmBlocks[ci].exercises[ei]) bmBlocks[ci].exercises[ei].reps = val; }
  function bmUpdateExIntensity(ci, ei, val){ if(bmBlocks[ci]&&bmBlocks[ci].exercises[ei]) bmBlocks[ci].exercises[ei].intensity = val; }
  function bmUpdateExUrl(ci, ei, val){ if(bmBlocks[ci]&&bmBlocks[ci].exercises[ei]) bmBlocks[ci].exercises[ei].url = val; }

  function bmAddExercise(ci){
    if(!bmBlocks[ci]) return;
    bmBlocks[ci].exercises.push({name:'', reps:'', intensity:'', url:''});
    // Re-render juste la liste
    const block = bmBlocks[ci];
    const list = document.getElementById('bm-exlist-'+ci);
    if(!list) return;
    list.innerHTML = block.exercises.map((ex, ei) => bmExRow(ci, ei, ex)).join('');
    // Focus dernier nom d'exercice
    const inputs = list.querySelectorAll('.bm-ex-name-input');
    if(inputs.length) inputs[inputs.length-1].focus();
    // Màj compteur
    const counter = document.getElementById('bm-counter-'+ci);
    if(counter) counter.textContent = block.exercises.length+' exercice'+(block.exercises.length!==1?'s':'');
  }

  function bmRemoveExercise(ci, ei){
    if(!bmBlocks[ci]) return;
    bmBlocks[ci].exercises.splice(ei, 1);
    bmRenderBlock(ci); // re-render complet pour mettre à jour les numéros
  }

  function bmPrevStep(){
    if(bmStep > 0){ bmStep--; bmRender(); }
  }

  function bmNextStep(){
    if(bmStep === 0){
      // Valider config
      bmTitle = (document.getElementById('bm-title-input')?.value || '').trim() || 'Séance block';
      bmColor = selectedSeanceColor || SEANCE_COLORS[1];
      // Ajuster les blocks si besoin
      while(bmBlocks.length < bmNbBlocks) bmBlocks.push({name:'', series:'', exercises:[]});
      bmBlocks = bmBlocks.slice(0, bmNbBlocks);
      bmStep = 1;
      bmRender();
    } else if(bmStep < bmNbBlocks){
      bmStep++;
      bmRender();
    } else {
      // Dernière étape : sauvegarder
      bmSave();
    }
  }

  async function bmSave(){
    const nextBtn = document.getElementById('bm-next-btn');
    nextBtn.textContent = '⏳'; nextBtn.disabled = true;
    try {
      if(bmEditingId){
        await sbFetch('seances?id=eq.'+bmEditingId,'PATCH',{
          title: bmTitle,
          color: bmColor,
          rpe: bmRpe,
          content: bmBlocks
        });
      } else {
        await sbFetch('seances','POST',{
          athlete_id: activeAthleteId,
          type: 'block',
          title: bmTitle,
          color: bmColor,
          rpe: bmRpe,
          content: bmBlocks
        });
      }
      nextBtn.disabled = false;
      closeBlockModal();
      const {data,athlete} = await getAthleteData();
      renderSeances(athlete.seances, athlete);
      renderInlineWeek(athlete);
    } catch(err){
      nextBtn.textContent = bmEditingId ? '✓ Enregistrer' : '✓ Créer la séance';
      nextBtn.disabled = false;
      console.error('bmSave:', err);
    }
  }

  // Alias pour compatibilité
  function updateRpeDisplay(val){ bmUpdateRpe(val); }
  function selectNbBlock(n){ bmSelectNbBlock(n); }



  /* ══ TESTS ══ */
  // Groupes de tests actifs (pour le graphique)
  let _testGroups = {};
  let _currentTestName = null;

  function renderTests(tests){
    const list = document.getElementById('tests-list');
    if(!list) return;
    if(!tests || !tests.length){
      list.innerHTML = `<div class="adp-empty">
        <div class="adp-empty-icon">📊</div>
        <div class="adp-empty-title">Aucun test</div>
        Cliquez sur "+ Ajouter un test" pour commencer.
      </div>`;
      _testGroups = {};
      return;
    }

    // Grouper par nom de test
    _testGroups = {};
    tests.forEach(t => {
      if(!_testGroups[t.name]) _testGroups[t.name] = [];
      _testGroups[t.name].push(t);
    });
    // Trier chaque groupe par date
    Object.values(_testGroups).forEach(g => g.sort((a,b) => new Date(a.rawDate||a.date) - new Date(b.rawDate||b.date)));

    list.innerHTML = Object.entries(_testGroups).map(([name, entries]) => {
      const last = entries[entries.length-1];
      return `
        <div class="test-group-card" onclick="openTestGraph('${escHtml(name).replace(/'/g,"\'")}')">
          <div class="test-group-icon">📊</div>
          <div class="test-group-info">
            <div class="test-group-name">${escHtml(name)}</div>
            <div class="test-group-meta">
              <span class="test-group-last">${escHtml(last.score)}</span>
              <span class="test-group-count">${entries.length} entrée${entries.length>1?'s':''} · dernier ${last.date}</span>
            </div>
          </div>
          <span class="test-group-arrow">›</span>
        </div>`;
    }).join('');
  }

  function showTestForm(){
    const wrap = document.getElementById('test-add-form-wrap');
    if(!wrap) return;
    wrap.innerHTML = `
      <div class="test-add-form" id="test-add-form">
        <div class="test-add-row">
          <div class="test-add-field">
            <span class="test-add-label">Nom du test</span>
            <input class="test-add-input" id="ta-name" type="text" placeholder="Ex : 1RM Squat, VMA, Cooper…" autofocus/>
          </div>
          <div class="test-add-field" style="flex:none">
            <span class="test-add-label">Score</span>
            <input class="test-add-input score" id="ta-score" type="text" placeholder="Ex : 120kg, 17.5…"/>
          </div>
          <button class="test-add-submit" onclick="submitTest()">Valider</button>
        </div>
        <button class="test-add-cancel" onclick="hideTestForm()">✕ Annuler</button>
      </div>`;
    document.getElementById('ta-name').focus();
  }

  function hideTestForm(){
    const wrap = document.getElementById('test-add-form-wrap');
    if(wrap) wrap.innerHTML = '';
  }

  async function submitTest(){
    const name = document.getElementById('ta-name')?.value.trim();
    const score = document.getElementById('ta-score')?.value.trim();
    if(!name || !score) return;
    const btn = document.querySelector('#test-add-form .test-add-submit');
    btn.textContent = '⏳'; btn.disabled = true;
    try {
      await sbFetch('tests','POST',{ athlete_id: activeAthleteId, name, score });
      hideTestForm();
      const {data,athlete} = await getAthleteData();
      renderTests(athlete.tests||[]);
    } catch(err){
      btn.textContent = 'Valider'; btn.disabled = false;
      console.error('submitTest:', err);
    }
  }

  async function deleteTest(id, e){
    e.stopPropagation();
    await sbFetch('tests?id=eq.'+id,'DELETE');
    const {data,athlete} = await getAthleteData();
    renderTests(athlete.tests||[]);
  }


  /* ══ TEST GRAPH ══ */
  let _tgChart = null;

  function openTestGraph(name){
    _currentTestName = name;
    const entries = _testGroups[name] || [];
    document.getElementById('tg-title').textContent = name;
    document.getElementById('test-graph-overlay').classList.add('open');
    document.getElementById('tg-score-input').value = '';
    renderTestGraph(entries);
  }

  function closeTestGraph(){
    document.getElementById('test-graph-overlay').classList.remove('open');
    if(_tgChart){ _tgChart.destroy(); _tgChart = null; }
    _athTestMode = false;
  }

  function renderTestGraph(entries){
    // Stats
    const scores = entries.map(e => parseFloat(e.score)).filter(v => !isNaN(v));
    const statsEl = document.getElementById('tg-stats');
    if(scores.length){
      const best = Math.max(...scores);
      const prog = scores.length > 1 ? (scores[scores.length-1] - scores[0]).toFixed(1) : null;
      statsEl.innerHTML = `
        <div class="tg-stat"><span class="tg-stat-label">Meilleur</span><span class="tg-stat-value">${best}</span></div>
        <div class="tg-stat"><span class="tg-stat-label">Entrées</span><span class="tg-stat-value">${entries.length}</span></div>
        ${prog!==null?`<div class="tg-stat"><span class="tg-stat-label">Progression</span><span class="tg-stat-value" style="color:${parseFloat(prog)>=0?'#90be6d':'#e63946'}">${parseFloat(prog)>=0?'+':''}${prog}</span></div>`:''}
      `;
    } else {
      statsEl.innerHTML = `<div class="tg-stat"><span class="tg-stat-label">Entrées</span><span class="tg-stat-value">${entries.length}</span></div>`;
    }

    // Canvas chart
    if(_tgChart){ _tgChart.destroy(); _tgChart = null; }
    const canvas = document.getElementById('tg-canvas');
    const ctx = canvas.getContext('2d');

    const labels = entries.map(e => {
      const d = new Date(e.rawDate || e.date);
      return isNaN(d) ? e.date : d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});
    });
    const data = entries.map(e => parseFloat(e.score));
    const allNumeric = data.every(v => !isNaN(v));

    if(allNumeric && entries.length > 0){
      _tgChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets:[{
            label: _currentTestName,
            data,
            borderColor: '#f4a261',
            backgroundColor: 'rgba(244,162,97,.08)',
            pointBackgroundColor: '#f4a261',
            pointRadius: 5,
            pointHoverRadius: 7,
            tension: 0.35,
            fill: true,
            borderWidth: 2,
          }]
        },
        options:{
          responsive:true,
          maintainAspectRatio:false,
          plugins:{
            legend:{display:false},
            tooltip:{
              backgroundColor:'#1a1a1a',
              borderColor:'rgba(255,255,255,.1)',
              borderWidth:1,
              titleColor:'rgba(240,236,228,.5)',
              bodyColor:'#f4a261',
              bodyFont:{family:'Bebas Neue',size:18},
              padding:12,
            }
          },
          scales:{
            x:{
              ticks:{color:'rgba(240,236,228,.3)',font:{family:'Outfit',size:11}},
              grid:{color:'rgba(255,255,255,.04)'},
            },
            y:{
              ticks:{color:'rgba(240,236,228,.3)',font:{family:'Outfit',size:11}},
              grid:{color:'rgba(255,255,255,.04)'},
            }
          }
        }
      });
    } else {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='rgba(240,236,228,.2)';
      ctx.font='14px Outfit';
      ctx.textAlign='center';
      ctx.fillText('Scores non numériques — courbe indisponible', canvas.width/2, canvas.height/2);
    }

    // Historique des entrées
    document.getElementById('tg-entries').innerHTML = [...entries].reverse().map(e => `
      <div class="tg-entry-wrap" id="tew-${e.id}">
        <div class="tg-entry">
          <span class="tg-entry-date">${e.date}</span>
          <span class="tg-entry-score">${escHtml(e.score)}</span>
          <button class="tg-entry-edit-btn" onclick="showTestEntryEdit('${e.id}','${escHtml(e.score).replace(/'/g,"\'")}','${e.rawDate||''}')" title="Modifier">✏️</button>
          <button class="tg-entry-delete" onclick="deleteTestEntry('${e.id}')" title="Supprimer">✕</button>
        </div>
        <div id="tef-${e.id}" style="display:none"></div>
      </div>`).join('');
  }

  async function submitNewScore(){
    const score = document.getElementById('tg-score-input')?.value.trim();
    if(!score || !_currentTestName) return;
    const btn = document.querySelector('.test-graph-modal .test-add-submit');
    btn.textContent='⏳'; btn.disabled=true;
    try {
      if(_athTestMode){
        // Mode athlète
        const savedLink = (()=>{ try{ return JSON.parse(localStorage.getItem('athlete_link_'+currentUser.username)||'null'); }catch(e){return null;} })();
        if(!savedLink) return;
        await sbFetch('tests','POST',{athlete_id:savedLink.athleteId, name:_currentTestName, score});
        const testRows = await sbFetch('tests?athlete_id=eq.'+savedLink.athleteId+'&select=*&order=created_at.desc');
        athData.tests = (testRows||[]).map(t=>({id:t.id,name:t.name,score:t.score,rawDate:t.created_at,date:new Date(t.created_at).toLocaleDateString('fr-FR')}));
        athData.tests.forEach(t=>{ if(!_testGroups[t.name]) _testGroups[t.name]=[]; });
        athData.tests.forEach(t=>{ _testGroups[t.name]=athData.tests.filter(x=>x.name===t.name).sort((a,b)=>new Date(a.rawDate)-new Date(b.rawDate)); });
        athRenderTests();
      } else {
        await sbFetch('tests','POST',{athlete_id:activeAthleteId, name:_currentTestName, score});
        const {data,athlete} = await getAthleteData();
        renderTests(athlete.tests||[]);
      }
      btn.textContent='+ Ajouter'; btn.disabled=false;
      document.getElementById('tg-score-input').value='';
      openTestGraph(_currentTestName);
    } catch(err){
      btn.textContent='+ Ajouter'; btn.disabled=false;
      console.error('submitNewScore:',err);
    }
  }

  function showTestEntryEdit(id, score, rawDate){
    // Fermer les autres forms ouverts
    document.querySelectorAll('.tg-entry-edit-form').forEach(f => f.remove());
    document.querySelectorAll('[id^="tef-"]').forEach(f => { if(f.id!=='tef-'+id) f.style.display='none'; });

    const wrap = document.getElementById('tef-'+id);
    if(!wrap) return;
    if(wrap.style.display !== 'none'){ wrap.style.display='none'; wrap.innerHTML=''; return; }

    // Formater la date pour input[type=date] (YYYY-MM-DD)
    let dateVal = '';
    if(rawDate){
      try{ dateVal = new Date(rawDate).toISOString().slice(0,10); }catch(e){}
    }

    wrap.innerHTML = `
      <div class="tg-entry-edit-form">
        <div class="tg-edit-field">
          <span class="tg-edit-label">Score</span>
          <input class="tg-edit-input" id="te-score-${id}" type="text" value="${escHtml(score)}" placeholder="Score…"/>
        </div>
        <div class="tg-edit-field">
          <span class="tg-edit-label">Date</span>
          <input class="tg-edit-input" id="te-date-${id}" type="date" value="${dateVal}"/>
        </div>
        <button class="tg-edit-save" onclick="saveTestEntry('${id}')">Enregistrer</button>
        <button class="tg-edit-cancel" onclick="cancelTestEdit('${id}')">Annuler</button>
      </div>`;
    wrap.style.display = 'block';
  }

  function cancelTestEdit(id){
    const wrap = document.getElementById('tef-'+id);
    if(wrap){ wrap.style.display='none'; wrap.innerHTML=''; }
  }

  async function saveTestEntry(id){
    const scoreInput = document.getElementById('te-score-'+id);
    const dateInput = document.getElementById('te-date-'+id);
    const score = scoreInput?.value.trim();
    const dateVal = dateInput?.value;
    if(!score) return;

    const btn = document.querySelector(`#tef-${id} .tg-edit-save`);
    if(btn){ btn.textContent='⏳'; btn.disabled=true; }

    const patch = {score};
    if(dateVal) patch.created_at = new Date(dateVal).toISOString();

    try {
      await sbFetch('tests?id=eq.'+id, 'PATCH', patch);
      const {data,athlete} = await getAthleteData();
      renderTests(athlete.tests||[]);
      openTestGraph(_currentTestName);
    } catch(err){
      if(btn){ btn.textContent='Enregistrer'; btn.disabled=false; }
      console.error('saveTestEntry:',err);
    }
  }

  async function deleteTestEntry(id){
    await sbFetch('tests?id=eq.'+id,'DELETE');
    if(_athTestMode){
      const savedLink = (()=>{ try{ return JSON.parse(localStorage.getItem('athlete_link_'+currentUser.username)||'null'); }catch(e){return null;} })();
      if(savedLink){
        const testRows = await sbFetch('tests?athlete_id=eq.'+savedLink.athleteId+'&select=*&order=created_at.desc');
        athData.tests = (testRows||[]).map(t=>({id:t.id,name:t.name,score:t.score,rawDate:t.created_at,date:new Date(t.created_at).toLocaleDateString('fr-FR')}));
        // Reconstruire _testGroups
        _testGroups = {};
        athData.tests.forEach(t=>{ if(!_testGroups[t.name]) _testGroups[t.name]=[]; _testGroups[t.name].push(t); });
        Object.values(_testGroups).forEach(g=>g.sort((a,b)=>new Date(a.rawDate)-new Date(b.rawDate)));
        athRenderTests();
      }
    } else {
      const {data,athlete} = await getAthleteData();
      renderTests(athlete.tests||[]);
    }
    if(_currentTestName && _testGroups[_currentTestName] && _testGroups[_currentTestName].length){
      renderTestGraph(_testGroups[_currentTestName]);
    } else {
      closeTestGraph();
    }
  }

  /* ══ SEANCE ACTION MENU ══ */
  let samSeanceId = null;

  function openSeanceActionMenu(e, sid){
    e.stopPropagation();
    samSeanceId = sid;
    const menu = document.getElementById('seance-action-menu');
    menu.classList.add('open');
    // position near click
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY + 8, window.innerHeight - 180);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
  }
  function closeSeanceActionMenu(){
    document.getElementById('seance-action-menu').classList.remove('open');
    samSeanceId = null;
  }
  document.addEventListener('click', e=>{
    const menu = document.getElementById('seance-action-menu');
    if(menu && !e.target.closest('#seance-action-menu')) closeSeanceActionMenu();
  });

  async function samEdit(){
    const sid = samSeanceId;
    closeSeanceActionMenu();
    const {data,athlete} = await getAthleteData();
    const s = athlete.seances.find(x=>x.id===sid);
    if(!s) return;
    if(s.type === 'ligne'){
      document.getElementById('lm-title').value = s.title;
      document.getElementById('lm-content').value = s.content||'';
      initSeanceColorPicker('lm-color-picker', s.color||null);
      _editingSeanceId = s.id;
      document.getElementById('ligne-modal-overlay').classList.add('open');
    } else {
      // block: ouvrir la modale en mode édition
      openBlockModalEdit(s);
    }
  }

  let _editingSeanceId = null;
  const _origSaveLigne = saveLigneModal;
  saveLigneModal = async function(){
    if(_editingSeanceId){
      const title = document.getElementById('lm-title').value.trim() || 'Séance libre';
      const content = document.getElementById('lm-content').value;
      const color = selectedSeanceColor || SEANCE_COLORS[0];
      await sbFetch('seances?id=eq.'+_editingSeanceId,'PATCH',{title,content,color});
      _editingSeanceId = null;
      closeLigneModal();
      const {data,athlete}=await getAthleteData();
      renderSeances(athlete.seances, athlete);
    } else {
      _editingSeanceId = null;
      await _origSaveLigne();
    }
  };

  async function samDelete(){
    const sid = samSeanceId;
    closeSeanceActionMenu();
    await sbFetch('seances?id=eq.'+sid,'DELETE');
    const {data,athlete} = await getAthleteData();
    renderSeances(athlete.seances, athlete);
  }

  function samAddToWeek(){
    const sid = samSeanceId; // sauvegarder AVANT closeSeanceActionMenu qui remet null
    closeSeanceActionMenu();
    openWeekPanel(sid);
  }

  /* ══ WEEK PANEL ══ */
  let weekOffset = 0;       // 0 = current week, -1 = last week, +1 = next week
  let weekSeanceId = null;  // seance being placed

  function getMondayOfWeek(offset){
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day); // distance to Monday
    const mon = new Date(now);
    mon.setDate(now.getDate() + diff + offset * 7);
    mon.setHours(0,0,0,0);
    return mon;
  }




  /* Validation par bloc (état local dans la session) */
  let _aspBlocksDone = {};

  function aspToggleBlock(blockIdx, btnId){
    const key = (_aspSeanceId||'') + '-block-' + blockIdx;
    _aspBlocksDone[key] = !_aspBlocksDone[key];
    const done = _aspBlocksDone[key];

    // Mettre à jour le bouton
    const btn = document.getElementById(btnId);
    if(btn){
      btn.className = 'asp-block-validate-btn' + (done ? ' done' : '');
      btn.innerHTML = done ? '✓ Bloc validé' : '✓ Valider ce bloc';
    }

    // Mettre à jour le visuel du bloc (parent du bouton)
    const section = btn ? btn.closest('.block-read-section') : null;
    if(section){
      if(done){
        section.classList.add('done');
      } else {
        section.classList.remove('done');
      }
    }

    // Si tous les blocs sont validés → cocher la séance automatiquement
    const seance = athData && athData.seances.find(s=>s.id===_aspSeanceId);
    if(seance && Array.isArray(seance.content)){
      const total = seance.content.length;
      const doneCount = seance.content.filter((_,i)=>_aspBlocksDone[(_aspSeanceId||'')+'-block-'+i]).length;
      if(doneCount === total && total > 0){
        const comps = athData.completions || {};
        const compKey = _aspSeanceId+'|'+_aspDateKey;
        if(!comps[compKey]) aspToggleComplete();
      }
    }
  }


  /* ── BULLE RPE RESSENTI ── */
  let _rpeSelected = null;
  let _rpeSeanceId = null;
  let _rpeDateKey = null;

  function openRpeBubble(seanceId, dateKey){
    _rpeSelected = null;
    _rpeSeanceId = seanceId;
    _rpeDateKey = dateKey;

    // Construire la grille 0-10
    const grid = document.getElementById('rpe-grid');
    grid.innerHTML = Array.from({length:11},(_,i)=>{
      const col = RPE_COLORS[i];
      return `<button class="rpe-btn" id="rpebtn-${i}" style="border:2px solid transparent"
        onclick="rpeSelect(${i})" data-rpe="${i}">${i}</button>`;
    }).join('');

    document.getElementById('rpe-label').textContent = '—';
    document.getElementById('rpe-confirm').disabled = true;
    document.getElementById('rpe-bubble-overlay').classList.add('open');
  }

  function rpeOverlayClick(e){
    if(e.target === document.getElementById('rpe-bubble-overlay')) rpeSkip();
  }

  function rpeSelect(val){
    _rpeSelected = val;
    // Visuels
    for(let i=0;i<=10;i++){
      const btn = document.getElementById('rpebtn-'+i);
      if(!btn) continue;
      if(i===val){
        btn.classList.add('selected');
        btn.style.background = RPE_COLORS[i];
        btn.style.borderColor = RPE_COLORS[i];
        btn.style.color = '#fff';
      } else {
        btn.classList.remove('selected');
        btn.style.background = 'rgba(255,255,255,.05)';
        btn.style.borderColor = 'transparent';
        btn.style.color = 'rgba(240,236,228,.4)';
      }
    }
    document.getElementById('rpe-label').textContent = RPE_LABELS[val]||'';
    document.getElementById('rpe-label').style.color = RPE_COLORS[val];
    document.getElementById('rpe-confirm').disabled = false;
  }

  async function rpeConfirm(){
    if(_rpeSelected === null) return;
    try {
      const key = _rpeSeanceId+'|'+_rpeDateKey;
      const comp = (athData.completions||{})[key];
      if(comp){
        await sbFetch('seance_completions?id=eq.'+comp.id, 'PATCH', {rpe_ressenti: _rpeSelected});
        athData.completions[key].rpe = _rpeSelected;
      }
    } catch(e){ console.error('rpeConfirm:', e); }
    rpeClose();
    // Rafraîchir la vue séance si ouverte
    if(_aspSeanceId === _rpeSeanceId && _aspDateKey === _rpeDateKey){
      openAthSeancePanel(_rpeSeanceId, _rpeDateKey);
    }
  }

  function rpeSkip(){
    rpeClose();
  }

  function rpeClose(){
    document.getElementById('rpe-bubble-overlay').classList.remove('open');
  }

  /* ── PANEL SÉANCE ATHLÈTE ── */
  let _aspSeanceId = null;
  let _aspDateKey = null;

  function openAthSeancePanel(seanceId, dateKey){
    const seance = athData.seances.find(s=>s.id===seanceId);
    if(!seance) return;
    _aspSeanceId = seanceId;
    _aspDateKey = dateKey;
    _aspBlocksDone = {}; // reset état blocs

    const DAYS_FR = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    const d = keyToDate(dateKey);
    const dayLabel = DAYS_FR[d.getDay()] + ' ' + d.getDate();

    const comps = athData.completions || {};
    const isDone = !!comps[seanceId+'|'+dateKey];

    const comp = (athData.completions||{})[seanceId+'|'+dateKey];
    const rpeRessenti = comp ? comp.rpe : null;
    let bodyHtml = '<div class="asp-day-badge">📅 '+dayLabel+'</div>';
    if(isDone && rpeRessenti !== null && rpeRessenti !== undefined){
      const rCol = RPE_COLORS[rpeRessenti];
      bodyHtml += '<div class="asp-rpe-ressenti"><div><div class="asp-rpe-ressenti-label">RPE Ressenti</div><div class="asp-rpe-ressenti-text" style="color:'+rCol+'">'+RPE_LABELS[rpeRessenti]+'</div></div><div class="asp-rpe-ressenti-val" style="color:'+rCol+'">'+rpeRessenti+'</div></div>';
    }
    if(seance.type === 'ligne'){
      bodyHtml += '<div style="font-size:15px;color:rgba(240,236,228,.8);line-height:1.8">'+escHtml(typeof seance.content==='string'?seance.content:'')+'</div>';
    } else {
      bodyHtml += athBlockReadHtml(seance);
    }
    bodyHtml += '<button class="asp-validate-btn'+(isDone?' done':'')+'" id="asp-validate-btn" onclick="aspToggleComplete()">'+(isDone?'✓ Séance terminée':'Valider la séance')+'</button>';

    document.getElementById('asp-title').textContent = seance.title;
    document.getElementById('asp-body').innerHTML = bodyHtml;
    document.getElementById('ath-seance-panel').classList.add('open');
    document.getElementById('screen-dashboard').style.overflow = 'hidden';
  }

  function closeAthSeancePanel(){
    document.getElementById('ath-seance-panel').classList.remove('open');
    document.getElementById('screen-dashboard').style.overflow = '';
  }

  async function aspToggleComplete(){
    if(!_aspSeanceId || !_aspDateKey) return;
    const comps = athData.completions || {};
    const key = _aspSeanceId+'|'+_aspDateKey;
    const isDone = !!comps[key];
    try {
      if(isDone){
        const entry = comps[key];
        await sbFetch('seance_completions?id=eq.'+entry.id, 'DELETE');
        delete athData.completions[key];
      } else {
        const rows = await sbFetch('seance_completions', 'POST', {
          athlete_id: athData.athlete.id,
          seance_id: _aspSeanceId,
          schedule_date: _aspDateKey
        });
        if(!athData.completions) athData.completions = {};
        athData.completions[key] = { id: rows[0].id, completedAt: rows[0].completed_at };
      }
      const newDone = !!athData.completions[key];
      const btn = document.getElementById('asp-validate-btn');
      if(btn){
        btn.className = 'asp-validate-btn'+(newDone?' done':'');
        btn.textContent = newDone ? '✓ Séance terminée' : 'Valider la séance';
      }
      athRenderWeek();
      athRenderSeances();
      // Ouvrir bulle RPE si on vient de valider
      if(newDone) openRpeBubble(_aspSeanceId, _aspDateKey);
    } catch(err){ console.error('aspToggleComplete:', err); }
  }

  /* ══ DATE HELPER — évite le décalage UTC ══ */
  function dateToKey(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+day;
  }
  function keyToDate(key){
    const [y,m,d] = key.split('-').map(Number);
    return new Date(y, m-1, d);
  }

  function getWeekDays(offset){
    const mon = getMondayOfWeek(offset);
    return Array.from({length:7},(_,i)=>{
      const d = new Date(mon);
      d.setDate(mon.getDate()+i);
      return d;
    });
  }

  async function openWeekPanel(sid){
    weekSeanceId = sid;
    dbgLog('openWeekPanel — weekSeanceId='+weekSeanceId);
    weekOffset = 0;
    const {data,athlete} = await getAthleteData();
    if(!athlete){ dbgLog('ERREUR: athlete non trouvé'); return; }
    document.getElementById('week-athlete-name').textContent = athlete.firstName+' '+athlete.lastName;
    document.getElementById('week-athlete-sub').textContent = 'Appuyez sur + pour ajouter la séance au jour voulu';
    renderWeekGrid(athlete);
    document.getElementById('week-panel').classList.add('open');
  }

  function closeWeekPanel(){
    document.getElementById('week-panel').classList.remove('open');
    weekSeanceId = null;
  }

  async function shiftWeek(dir){
    weekOffset += dir;
    const {data,athlete} = await getAthleteData();
    renderWeekGrid(athlete);
  }


  /* ══ WEEK GRID ══ */
  async function renderWeekGrid(athlete){
    // Toujours charger les completions fraîches depuis Supabase
    let freshCompletions = athlete.completions || [];
    try {
      const rows = await sbFetch('seance_completions?athlete_id=eq.'+athlete.id+'&select=*');
      if(rows) freshCompletions = rows;
    } catch(e){}

    const compMap = {};
    freshCompletions.forEach(r=>{ compMap[r.seance_id+'|'+r.schedule_date]={done:true,rpe:r.rpe_ressenti??null}; });

    const days = getWeekDays(weekOffset);
    const DAYS_FR = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    const today = new Date(); today.setHours(0,0,0,0);
    const fmt = d => d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'});
    document.getElementById('week-range-label').textContent = fmt(days[0])+' — '+fmt(days[6]);
    document.getElementById('week-panel-title').textContent = 'Semaine du '+fmt(days[0]);
    const schedule = athlete.schedule || {};
    const placing = !!weekSeanceId;

    document.getElementById('week-grid').innerHTML = days.map((d,i)=>{
      const key = dateToKey(d);
      const isToday = d.getTime()===today.getTime();
      const slots = schedule[key]||[];

      const pillsHtml = slots.map(slot=>{
        const compEntry = compMap[slot.sid+'|'+key];
        const isComp = !!compEntry;
        const slotRpe = compEntry?.rpe ?? null;
        return `<div class="week-seance-pill${isComp?' completed':''}" style="--pill-color:${slot.color||'#2ec4b6'};border-left-color:${isComp?'#2ec4b6':slot.color||'#2ec4b6'}">
          <span class="pill-title${isComp?' done':''}">${escHtml(slot.title)}</span>
          ${isComp ? '<div class="pill-comp-row">✓ Complété'+(slotRpe!==null?' · RPE <strong>'+slotRpe+'</strong>':'')+'</div>' : ''}
        </div>`;
      }).join('');

      return `<div class="day-col">
        <div class="day-header${isToday?' today':''}" onclick="openDayPage('${key}','${DAYS_FR[i]} ${d.getDate()}')">
          <div class="day-name">${DAYS_FR[i]}</div>
          <div class="day-num">${d.getDate()}</div>
        </div>
        ${pillsHtml}
        <button class="day-add-btn${placing?' highlight':''}" onclick="clickDayAddBtn(event,'${key}')">
          <span class="plus-circle">+</span>${placing?' Ajouter ici':''}
        </button>
      </div>`;
    }).join('');
  }

  /* Click on day: if placing → add; otherwise → open day page */
  function handleDayClick(key, dayName, dayNum){
    if(weekSeanceId){
      addSeanceToDay(key);
    } else {
      openDayPage(key, dayName+' '+dayNum);
    }
  }

  // Appelé par le bouton + sous chaque jour
  function clickDayAddBtn(e, dateKey){
    e.stopPropagation();
    e.preventDefault();
    dbgLog('clickDayAddBtn — weekSeanceId='+weekSeanceId+' dateKey='+dateKey);
    if(!weekSeanceId){
      return;
    }
    addSeanceToDay(dateKey);
  }

  async function addSeanceToDay(dateKey){
    dbgLog('addSeanceToDay — dateKey='+dateKey+' weekSeanceId='+weekSeanceId);
    if(!weekSeanceId) return;
    const sid = weekSeanceId;

    // 1. Charger la séance pour avoir son titre et type
    const {data,athlete} = await getAthleteData();
    const seance = (athlete.seances||[]).find(x=>x.id===sid);
    if(!seance) return;

    // 2. Mise à jour optimiste : ajouter immédiatement dans le schedule local
    if(!athlete.schedule) athlete.schedule={};
    if(!athlete.schedule[dateKey]) athlete.schedule[dateKey]=[];
    const alreadyThere = athlete.schedule[dateKey].find(x=>x.sid===sid);
    if(!alreadyThere){
      athlete.schedule[dateKey].push({
        sid: seance.id,
        title: seance.title,
        type: seance.type,
        color: seance.color||'#2ec4b6',
        content: seance.content||'',
        scheduleId: 'temp-'+Date.now(),
        position: athlete.schedule[dateKey].length
      });
    }

    // 3. Désactiver le mode placement et re-rendre immédiatement
    weekSeanceId = null;
    document.getElementById('week-athlete-sub').textContent='Séance ajoutée ! Cliquez sur un jour pour voir le détail';
    renderWeekGrid(athlete);
    // Refresh inline week dans l'onglet séances
    renderInlineWeek(athlete);

    // 4. Sauvegarder en base en arrière-plan (sans bloquer l'UI)
    if(!alreadyThere){
      try {
        await sbFetch('schedule','POST',{
          athlete_id: activeAthleteId,
          seance_id: sid,
          date: dateKey,
          position: (athlete.schedule[dateKey].length - 1)
        });
      } catch(err){
        console.error('Erreur sauvegarde schedule:', err);
      }
    }
  }

  async function removeFromDay(dateKey,sid,e){
    if(e) e.stopPropagation();
    await sbFetch('schedule?athlete_id=eq.'+activeAthleteId+'&seance_id=eq.'+sid+'&date=eq.'+dateKey,'DELETE');
    const {data,athlete}=await getAthleteData();
    renderWeekGrid(athlete);
    renderInlineWeek(athlete);
    if(currentDayKey===dateKey) renderDayPage(athlete,dateKey,currentDayLabel);
  }

  /* ══ DAY DETAIL PAGE ══ */
  let currentDayKey=null, currentDayLabel='', ddpDragSrc=null;

  async function openDayPage(dateKey, label){
    currentDayKey=dateKey; currentDayLabel=label;
    const {data,athlete}=await getAthleteData();
    renderDayPage(athlete,dateKey,label);
    document.getElementById('day-detail-panel').classList.add('open');
  }

  function closeDayDrawer(){ closeDayPage(); }
  function closeDayPage(){
    document.getElementById('day-detail-panel').classList.remove('open');
    currentDayKey=null;
  }

  function renderDayPage(athlete,dateKey,label){
    const MONTHS=['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
    const d=new Date(dateKey+'T12:00:00');
    const fullDate=d.getDate()+' '+MONTHS[d.getMonth()]+' '+d.getFullYear();
    const DAYS_FULL=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const dayName=DAYS_FULL[d.getDay()];

    document.getElementById('ddp-nav-title').textContent=label;
    document.getElementById('ddp-day-title').textContent=dayName;
    document.getElementById('ddp-day-sub').textContent=fullDate;

    const schedule=athlete.schedule||{};
    const slots=schedule[dateKey]||[];
    const seancesLib=athlete.seances||[];

    if(!slots.length){
      document.getElementById('ddp-list').innerHTML=`
        <div class="ddp-empty-day">
          <div class="es-icon">🏋️</div>
          <div class="adp-empty-title">Aucune séance</div>
          Aucune séance programmée ce jour.
        </div>`;
      return;
    }

    document.getElementById('ddp-list').innerHTML=slots.map((slot,i)=>{
      const full=seancesLib.find(x=>x.id===slot.sid)||{};
      const content=full.content||slot.content||'';
      let bodyHtml='';
      if(slot.type==='ligne'){
        bodyHtml=`<div class="ddp-ligne-content">${escHtml(typeof content==='string'?content:'')}</div>`;
      } else {
        const circuits=Array.isArray(content)?content:[];
        bodyHtml=circuits.map(circ=>`
          <div style="margin-bottom:14px">
            <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:rgba(244,162,97,.8);margin-bottom:8px">${escHtml(circ.name||'Circuit')}</div>
            ${(circ.exercises||[]).map(ex=>`<div style="font-size:14px;color:rgba(240,236,228,.7);padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05)">• ${escHtml(ex)}</div>`).join('')}
          </div>`).join('')||'<div style="color:rgba(240,236,228,.3);font-size:13px">Aucun exercice.</div>';
      }
      return `
        <div class="ddp-seance" id="ddp-${i}"
          draggable="true"
          ondragstart="ddpDragStart(event,${i})"
          ondragover="ddpDragOver(event,${i})"
          ondrop="ddpDrop(event,${i})"
          ondragend="ddpDragEnd(event)">
          <div class="ddp-seance-header">
            <span class="ddp-drag-handle">⠿</span>
            <div class="ddp-seance-meta">
              <div class="ddp-seance-title">
                <span class="seance-type-badge ${slot.type}" style="margin-right:8px">${slot.type==='ligne'?'Ligne':'Block'}</span>
                ${escHtml(slot.title)}
              </div>
            </div>
            <button class="ddp-seance-remove" onclick="removeFromDay('${dateKey}','${slot.sid}',event)">✕</button>
          </div>
          <div class="ddp-seance-body">${bodyHtml}</div>
        </div>`;
    }).join('');
  }

  function ddpDragStart(e,i){ddpDragSrc=i;e.currentTarget.classList.add('dragging');e.dataTransfer.effectAllowed='move';}
  function ddpDragOver(e,i){e.preventDefault();document.querySelectorAll('.ddp-seance').forEach((el,j)=>el.classList.toggle('drag-over',j===i&&i!==ddpDragSrc));}
  function ddpDragEnd(e){e.currentTarget.classList.remove('dragging');document.querySelectorAll('.ddp-seance').forEach(el=>el.classList.remove('drag-over'));}
  async function ddpDrop(e,targetIdx){
    e.preventDefault();
    if(ddpDragSrc===null||ddpDragSrc===targetIdx){ddpDragSrc=null;return;}
    const {data,athlete}=await getAthleteData();
    const slots=athlete.schedule[currentDayKey]||[];
    const moved=slots.splice(ddpDragSrc,1)[0];
    slots.splice(targetIdx,0,moved);
    // update positions in DB
    await Promise.all(slots.map((s,i)=>
      sbFetch('schedule?id=eq.'+s.scheduleId,'PATCH',{position:i})
    ));
    ddpDragSrc=null;
    const {data:d2,athlete:a2}=await getAthleteData();
    renderDayPage(a2,currentDayKey,currentDayLabel);
    renderWeekGrid(a2);
  }


  // ── DEBUG ──
  const _origError = console.error.bind(console);
  console.error = function(...args){ _origError(...args); dbgLog('ERROR: '+args.join(' ')); };
  window.addEventListener('error', e => dbgLog('UNCAUGHT: '+e.message+' ('+e.filename+':'+e.lineno+')'));
  window.addEventListener('unhandledrejection', e => dbgLog('PROMISE: '+(e.reason?.message||e.reason)));
  function dbgLog(msg){
    const p=document.getElementById('debug-panel');
    if(!p)return;
    p.classList.add('visible');
    const line=document.createElement('div');
    line.textContent=new Date().toLocaleTimeString()+' '+msg;
    p.prepend(line);
  }
  // Wrap confirmAthlete pour logger
  const _origConfirmAthlete = confirmAthlete;
  confirmAthlete = async function(){
    try { await _origConfirmAthlete(); dbgLog('confirmAthlete() OK'); }
    catch(e){ dbgLog('confirmAthlete() ERREUR: '+e.message); throw e; }
  };
  function handleLogout(){currentUser=null;menuOpen=false;try{localStorage.removeItem('app_session');}catch(e){}document.getElementById('dropdown').classList.remove('open');closeGroupDetail();showScreen('screen-roles')}
