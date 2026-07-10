import pg from "pg";
for(let i=1;i<=120;i++){
  const c=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000});
  try{ await c.connect(); await c.query("SELECT 1"); console.log("DB-RECOVERED after ~"+(i*15)+"s"); await c.end(); process.exit(0); }
  catch(e:any){ if(i%8===0) console.log("still down ("+String(e.message).slice(0,40)+") ~"+(i*15)+"s"); await c.end().catch(()=>{}); }
  await new Promise(r=>setTimeout(r,15000));
}
console.log("DB-STILL-DOWN after 30min"); process.exit(1);
