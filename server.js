const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());


let tunnelConfig = {

    name:"argo-node",

    protocol:"auto",

    modes:[
        "quic",
        "http2"
    ],

    status:"running"

};



app.get("/",(req,res)=>{

res.json({

    name:"Cloudflare Argo Manager",

    status:"online",

    tunnel:tunnelConfig

});

});




app.get("/api/tunnel",(req,res)=>{

res.json(tunnelConfig);

});




app.post("/api/tunnel",(req,res)=>{


tunnelConfig={

...tunnelConfig,

...req.body

};


res.json({

success:true,

config:tunnelConfig

});


});




const PORT =
process.env.PORT || 3000;


app.listen(PORT,()=>{

console.log(
"Server running:",
PORT
);

});
