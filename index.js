const http=require("http");
const fs=require("fs");


const port=process.env.PORT || 3000;


http.createServer((req,res)=>{


if(req.url=="/"){

let data="";

try{
data=fs.readFileSync("./sub.txt","utf8");
}catch(e){

data="正在生成节点..."

}


res.writeHead(200,{
"Content-Type":"text/plain;charset=utf-8"
});


res.end(
"Sing-box Argo Node\n\n"+
data
);


return;

}



res.end("OK");


}).listen(port);


console.log(
"HTTP running:",
port
);
