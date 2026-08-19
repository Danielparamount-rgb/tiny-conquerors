'use strict';
/* ================= player options (persisted, read-before-anything) ========
   OPT holds every toggle the Settings panel offers. Missing keys mean "the
   default": haptics on, coach on, weather on, telemetry OFF (opt-in). */
const OPT=(()=>{try{return Object.assign({},JSON.parse(localStorage.getItem('tq_opts')||'{}'));}catch(e){return{};}})();
function saveOpts(){try{localStorage.setItem('tq_opts',JSON.stringify(OPT));}catch(e){}}
function buzz(p){if(OPT.haptics!==false&&navigator.vibrate)try{navigator.vibrate(p);}catch(e){}}
/* tiny corner chip for background asset downloads — silence reads as broken */
function dlChip(txt){
  let c=document.getElementById('dlChip');
  if(!txt){if(c)c.style.display='none';return;}
  if(!c){
    c=document.createElement('div');c.id='dlChip';
    c.style.cssText='position:fixed;left:8px;bottom:8px;z-index:9;padding:5px 10px;'
      +'background:rgba(30,24,16,.9);border:1px solid #6b5330;border-radius:8px;'
      +'color:#cbb98a;font:11.5px system-ui;pointer-events:none';
    document.body.appendChild(c);
  }
  c.style.display='';c.textContent=txt;
}
try{document.documentElement.lang=document.documentElement.lang||'en';}catch(e){}
/* Localization scaffold: T('key','English fallback'). A translation ships as a
   replacement STR table; untranslated keys fall back to the inline English, so
   extraction can proceed string by string without ever breaking the page. */
let STR={};
function T(key,fallback){return STR[key]!==undefined?STR[key]:fallback;}
