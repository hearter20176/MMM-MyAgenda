function _escapeRegExp(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}
const frag = '[07 Life Science-Durot]';
const esc = _escapeRegExp(frag);
console.log('escaped:', esc);
const rx = new RegExp(esc, 'gi');
console.log('regex', rx);
console.log('replace', 'abc [07 Life Science-Durot] def'.replace(rx, ''));
