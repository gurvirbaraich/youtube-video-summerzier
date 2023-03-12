const dotenv = require("dotenv");
const express = require("express");
const session = require("express-session");

dotenv.config();

const app = express();
const { Configuration, OpenAIApi } = require("openai");
const http = require("http").createServer(app);
const youtubeTranscript = require("youtube-transcript").default;

const io = require("socket.io")(http);

const configuration = new Configuration({
   apiKey: process.env.OPENAI_API_KEY,
});

app.use(session({
   secret: "d87545344cad5d754236665515d3a145",
   cookie: {
      expires: false,
   },
   saveUninitialized: false
}))

app.set("view engine", "ejs");

const openai = new OpenAIApi(configuration);
const stripe = require('stripe')(process.env.STRIPE_API_KEY);

app.get("/", async function (req, res) {
   const customer = await stripe.customers.create();

   const paymentIntent = await stripe.paymentIntents.create({
      customer: customer.id,
      setup_future_usage: 'off_session',
      amount: 50,
      currency: 'inr',
      payment_method_types: ['card'],
   });

   res.render("index", { api_key: process.env.STRIPE_API_KEY, client_secret: paymentIntent.client_secret, skip: req.session.free_count > 0 ? true : false });
});

app.get("/verify/:v", function (req, res) {
   req.session.free_count = 5;
   req.session.payment_intent_client_secret = req.query.payment_intent_client_secret;

   res.redirect("/watch/" + req.params.v)
});

app.get("/watch/:v", function (req, res) {
   let client_secret = req.session.payment_intent_client_secret;

   if (req.session.free_count > 0)
      req.session.free_count -= 1;
   else 
      delete req.session.payment_intent_client_secret;

   let vID = "";

   try {
      new URL(req.params.v)
      vID = req.params.v.replace("https://www.youtube.com/watch?v=", "");
      vID = req.params.v == vID ? req.params.v.replace("https://youtu.be/", "") : vID;
   } catch (e) {
      vID = req.params.v
   }

   res.render("watch", { api_key: process.env.STRIPE_API_KEY, video_id: vID, client_secret: typeof client_secret === "string" ? client_secret : "null"});
});

io.on("connection", (socket) => {
   socket.on("v", (v) => {
      youtubeTranscript
         .fetchTranscript(v)
         .then(async (t) => {
            const transcripts = t.flatMap((o) => o.text).join("");

            const prompt = `
            PROMPT: Make a summary;
            INPUT: ${transcripts};
         `;

            const request = getSummary(prompt, transcripts.length);

            request.then((response) => {
               socket.emit("details", {
                  usage: response.data.usage,
                  summary: response.data.choices[0].text,
               });
            });
         })

         .catch((e) => {
            console.log(e.message);
         });
   });
});

async function getSummary(prompt, length) {
   return await openai.createCompletion({
      top_p: 1,
      stream: false,
      prompt: prompt,
      temperature: 0.7,
      model: "text-davinci-003",
      max_tokens:
         Math.floor(length * 0.35) > 512 ? 512 : Math.floor(length * 0.35),
   });
}

http.listen(process.env.APPLICATION_PORT || 3000, () => {
   console.log(`Listening on port: ${process.env.APPLICATION_PORT || 3000}`);
});
