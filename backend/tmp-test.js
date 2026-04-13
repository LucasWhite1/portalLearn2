const db=require('./src/db');
const bcrypt=require('bcrypt');
(async()=>{
  const text='SELECT password_hash FROM users WHERE email=';
  const params=['admin@curso.com'];
  console.log('text',text);
  console.log('params',params);
  const {rows}=await db.query(text,params);
  console.log(rows[0]);
  const match=await bcrypt.compare('AdminPass2026!',rows[0].password_hash);
  console.log('match',match);
})().catch(err=>{console.error(err);process.exit(1);});
