import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type DocumentSegment={id:string;kind:'heading'|'paragraph'|'list-item'|'table-cell'|'line';text:string;separator:string;page?:number;row?:number;column?:number;level?:number};
export type ExtractedDocument={text:string;segments:DocumentSegment[];warnings:string[];requiresReview?:boolean};

function decodeEntities(value:string){
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(entity,code:string)=>{
    const named:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
    if(code[0]==='#'){const hex=code[1]?.toLowerCase()==='x';const point=Number.parseInt(code.slice(hex?2:1),hex?16:10);try{return String.fromCodePoint(point)}catch{return entity}}
    return named[code.toLowerCase()]||entity;
  });
}

function extractDocxHtml(html:string):DocumentSegment[]{
  const tokens=html.match(/<[^>]+>|[^<]+/g)||[];const segments:DocumentSegment[]=[];let nextId=0;let block='';let blockKind:DocumentSegment['kind']='paragraph';let blockLevel:number|undefined;let row:number|undefined;let rowNumber=0;let cell:string|null=null;let cells:string[]=[];const lists:{type:'ol'|'ul';count:number}[]=[];
  const add=(kind:DocumentSegment['kind'],value:string,separator:string,extra:Partial<DocumentSegment>={})=>{if(!value.trim())return;segments.push({id:`d${++nextId}`,kind,text:value.trim(),separator,...extra})};
  const flush=()=>{add(blockKind,block,'\n\n',blockLevel?{level:blockLevel}:{});block='';blockKind='paragraph';blockLevel=undefined};
  for(const token of tokens){
    if(!token.startsWith('<')){const value=decodeEntities(token);if(cell!==null)cell+=value;else block+=value;continue;}
    const close=/^<\//.test(token);const tag=token.match(/^<\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();if(!tag)continue;
    if(tag==='table'){if(close)row=undefined;continue;}
    if(tag==='tr'){if(close){cells.forEach((value,column)=>add('table-cell',value,column===cells.length-1?'\n':'\t',{row,column}));row=undefined;cells=[];}else{row=rowNumber++;cells=[];}continue;}
    if(tag==='td'||tag==='th'){if(close){if(cell!==null)cells.push(cell.trim());cell=null;}else cell='';continue;}
    if(cell!==null)continue;
    if(tag==='ol'||tag==='ul'){if(close)lists.pop();else{const start=tag==='ol'?Number(token.match(/\bstart\s*=\s*["']?(\d+)/i)?.[1]||1):1;lists.push({type:tag,count:start-1});}continue;}
    if(/^h[1-6]$/.test(tag)){if(close)flush();else{flush();blockKind='heading';blockLevel=Number(tag[1]);}continue;}
    if(tag==='p'){if(close)flush();else{flush();blockKind='paragraph'}continue;}
    if(tag==='li'){if(close)flush();else{flush();blockKind='list-item';const list=lists.at(-1);if(list?.type==='ol'){list.count++;block=`${list.count}. `}else block='• ';}continue;}
    if(tag==='br'&&!close)block+='\n';
  }
  flush();return segments;
}

function extractPdfPage(items:unknown[],page:number,startId:number){
  type Positioned={text:string;x:number;y:number;height:number;width:number};const positioned:Positioned[]=[];
  for(const raw of items){if(!raw||typeof raw!=='object'||!('str'in raw)||typeof raw.str!=='string'||!raw.str.trim())continue;const item=raw as {str:string;transform?:number[];height?:number;width?:number};positioned.push({text:raw.str.trim(),x:item.transform?.[4]||0,y:item.transform?.[5]||0,height:item.height||10,width:item.width||0});}
  positioned.sort((a,b)=>b.y-a.y||a.x-b.x);const lines:{y:number;height:number;items:Positioned[]}[]=[];
  for(const item of positioned){let line=lines.find(candidate=>Math.abs(candidate.y-item.y)<=Math.max(2,item.height*.35));if(!line){line={y:item.y,height:item.height,items:[]};lines.push(line);}line.items.push(item);line.height=Math.max(line.height,item.height);}
  lines.sort((a,b)=>b.y-a.y);let wideGap=false;const segments:DocumentSegment[]=[];let previous:typeof lines[number]|undefined;
  for(const line of lines){line.items.sort((a,b)=>a.x-b.x);let text='';let right=0;for(const item of line.items){const gap=item.x-right;text+=text?(gap>Math.max(28,line.height*2.5)?'\t':gap>line.height*.4?' ':'')+item.text:item.text;right=item.x+item.width;if(gap>Math.max(28,line.height*2.5))wideGap=true;}const separator=previous&&previous.y-line.y>line.height*1.8?'\n\n':'\n';segments.push({id:`p${startId+segments.length+1}`,kind:'line',text,separator,page});previous=line;}
  return{segments,wideGap};
}

export async function extractDocument(buffer:Buffer,filename:string):Promise<ExtractedDocument>{
  const ext=filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if(ext==='.docx'){
    if(buffer.length<4||buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(new Error('This file is not a valid DOCX package. Re-save it as a Word document and try again.'),{status:415});
    const result=await mammoth.convertToHtml({buffer});const segments=extractDocxHtml(result.value);const text=segments.map(segment=>segment.text+segment.separator).join('').trim();
    if(!text)throw Object.assign(new Error('No readable text was found in this DOCX.'),{status:422});
    const warnings=[...(result.messages.length?['Some document styles or elements were not recognized during extraction.']:[]),'Text and basic paragraph/list/table structure were extracted. Original Word styling is not retained in the editor yet.'];
    return{text,segments,warnings};
  }
  if(ext==='.pdf'){
    if(buffer.length<5||buffer.subarray(0,5).toString('ascii')!=='%PDF-')throw Object.assign(new Error('This file does not contain a valid PDF signature.'),{status:415});
    const pdf=await pdfjs.getDocument({data:new Uint8Array(buffer),useSystemFonts:true}).promise;const segments:DocumentSegment[]=[];let wideGap=false;
    for(let page=1;page<=pdf.numPages;page++){const content=await(await pdf.getPage(page)).getTextContent();const extracted=extractPdfPage(content.items,page,segments.length);segments.push(...extracted.segments);wideGap=wideGap||extracted.wideGap;if(page<pdf.numPages&&segments.length)segments[segments.length-1].separator='\n\n';}
    const text=segments.map(segment=>segment.text+segment.separator).join('').trim();if(!text)throw Object.assign(new Error('No selectable text was found in this PDF. It may be scanned or image-only; OCR is not configured.'),{status:422});
    const warnings=['PDF text order was reconstructed from page positions; tables, columns, and scanned pages need visual review.',...(wideGap?['Wide text gaps were found; check that columns or table cells were not joined in the wrong order before translating.']:[])];return{text,segments,warnings,requiresReview:wideGap};
  }
  throw Object.assign(new Error('Server extraction currently supports DOCX and PDF. TXT and CSV can be opened directly.'),{status:415});
}
