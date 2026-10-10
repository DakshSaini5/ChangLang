import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { z } from 'zod';
import { polishEmail, translateText, writingSuggestion } from './services/ai.js';
import { extractDocument } from './services/document-extract.js';

const app=express();
const port=Number(process.env.PORT||4000);
app.disable('x-powered-by');
app.use(cors({origin:process.env.WEB_ORIGIN||'http://localhost:5173'}));
app.use(express.json({limit:'1mb'}));
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'langchain-api',translationConfigured:Boolean(process.env.GEMINI_API_KEY)}));
app.post('/api/translate',async(req,res,next)=>{try{const segment=z.object({id:z.string().min(1).max(100),kind:z.enum(['heading','paragraph','list-item','table-cell','line']),text:z.string().max(20000),separator:z.string().max(100),page:z.number().int().positive().optional(),row:z.number().int().nonnegative().optional(),column:z.number().int().nonnegative().optional(),level:z.number().int().min(1).max(6).optional()});const glossaryEntry=z.object({source:z.string().trim().min(1).max(150),target:z.string().trim().min(1).max(150)});const schema=z.object({text:z.string().min(1).max(100000),segments:z.array(segment).max(5000).optional(),glossary:z.array(glossaryEntry).max(300).optional(),source:z.enum(['English','Hindi']),target:z.enum(['English','Hindi']),mode:z.string().optional()});const input=schema.parse(req.body);const result=await translateText(input);res.json(result)}catch(e){next(e)}});
app.post('/api/assist',async(req,res,next)=>{try{const schema=z.object({text:z.string().trim().min(1).max(30000),operation:z.enum(['clarity','proofread','formal','simplify','summary','rewrite']).default('clarity')});const input=schema.parse(req.body);const suggestion=await writingSuggestion(input);res.json({suggestion})}catch(e){next(e)}});
app.post('/api/email/polish',async(req,res,next)=>{try{const schema=z.object({subject:z.string().max(1000).default(''),body:z.string().max(30000).default('')});const input=schema.parse(req.body);const polished=await polishEmail(input);res.json({polished})}catch(e){next(e)}});
const maxMb=Number(process.env.MAX_UPLOAD_MB||20);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:maxMb*1024*1024,files:5},fileFilter:(_req,file,cb)=>{const allowed=['.docx','.pdf','.txt','.csv'];const ext=file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];if(!ext||!allowed.includes(ext))return cb(new Error('Supported formats: DOCX, PDF, TXT and CSV.'));cb(null,true)}});
const documentUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:maxMb*1024*1024,files:1}});
app.post('/api/documents/extract',documentUpload.single('file'),async(req,res,next)=>{try{
  const file=req.file;if(!file)return res.status(400).json({error:'Choose a document to extract.'});
  const extracted=await extractDocument(file.buffer,file.originalname);const format=file.originalname.toLowerCase().endsWith('.pdf')?'PDF':'DOCX';
  res.json({name:file.originalname,format,...extracted});
}catch(e){next(e)}});
app.post('/api/documents/upload',upload.array('files',5),(req,res)=>{const files=req.files as Express.Multer.File[]|undefined;if(!files?.length)return res.status(400).json({error:'Choose at least one file.'});res.status(501).json({error:'Private document storage is not configured. Add Supabase credentials and configure a private bucket before uploading documents to the service.',files:files.map(f=>({name:f.originalname,size:f.size}))})});
app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(err instanceof z.ZodError)return res.status(400).json({error:'Invalid request',details:err.issues.map(i=>({field:i.path.join('.'),message:i.message}))});if(err instanceof multer.MulterError)return res.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:err.code==='LIMIT_FILE_SIZE'?`File exceeds the ${maxMb} MB limit.`:'Invalid upload.'});if(err instanceof Error&&err.message.startsWith('Supported formats:'))return res.status(415).json({error:err.message});const error=err as Error&{status?:number};const message=err instanceof Error?err.message:'Unexpected server error';const status=error.status|| (message==='Translation service is not configured.'||message==='AI service is not configured.'||message.includes('temporarily busy')||message.includes('rate limiting')?503:message.includes('provider')||message.includes('Gemini model')||message.includes('API key')?502:400);res.status(status).json({error:message})});
app.listen(port,()=>console.log(`LangChain API listening on http://localhost:${port}`));
