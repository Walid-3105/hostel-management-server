require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ad8zj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const userCollection = client.db("hostelDB").collection("users");
    const mealCollection = client.db("hostelDB").collection("meals");
    const requestCollection = client.db("hostelDB").collection("requests");
    const reviewCollection = client.db("hostelDB").collection("reviews");
    const paymentCollection = client.db("hostelDB").collection("payments");

    // jwt related api

    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: "2h" });
      res.send({ token });
    });

    // middleware
    const verifyToken = (req, res, next) => {
      // console.log("inside the verify token", req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized Access" });
      }
      const token = req.headers.authorization.split(" ")[1];

      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "Unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // user verifyAdmin after user verifyToken-------------------------------------
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // user related api
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users", async (req, res) => {
      // todo: add verifyToken
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is Needed" });
      }
      const filter = { email };
      const result = await userCollection.find(filter).toArray();
      res.send(result);
    });

    app.get("/allUsers", async (req, res) => {
      // add verifyToken & verifyAdmin
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    //   admin Related api
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    // meals related api----------------------------------------------
    app.post("/meal", verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      const result = await mealCollection.insertOne(data);
      res.send(result);
    });

    app.get("/meal", async (req, res) => {
      const result = await mealCollection.find().toArray();
      res.send(result);
    });

    app.get("/meal/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await mealCollection.findOne(query);
      res.send(result);
    });

    app.patch("/meal/:id", async (req, res) => {
      const { likes, reviews_count } = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const existingMeal = await mealCollection.findOne(filter);
      const updatedDoc = {
        $set: {
          likes: likes !== undefined ? likes : existingMeal.likes,
          reviews_count:
            reviews_count !== undefined
              ? reviews_count
              : existingMeal.reviews_count,
        },
      };
      const result = await mealCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // request meal related api
    app.post("/request", verifyToken, async (req, res) => {
      const request = req.body;
      const result = await requestCollection.insertOne(request);
      res.send(result);
    });

    app.get("/request", async (req, res) => {
      // todo: add verifyToken
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is Needed" });
      }
      const filter = { email };
      const result = await requestCollection.find(filter).toArray();
      res.send(result);
    });

    app.get("/requests", async (req, res) => {
      // todo: add verifyToken and verifyAdmin
      const result = await requestCollection.find().toArray();
      res.send(result);
    });

    // review meal related api
    app.post("/review", async (req, res) => {
      const request = req.body;
      const result = await reviewCollection.insertOne(request);
      res.send(result);
    });

    app.get("/review", async (req, res) => {
      // todo: add verifyToken
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is Needed" });
      }
      const filter = { email };
      const result = await reviewCollection.find(filter).toArray();
      res.send(result);
    });

    // payment related api
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      const price = parseInt(amount * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: price,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payment", async (req, res) => {
      // add verifyToken
      const payment = req.body;
      const { email, packageName } = payment;
      console.log(payment);
      const paymentResult = await paymentCollection.insertOne(payment);

      let badge;
      if (packageName === "Silver") {
        badge = "Silver";
      } else if (packageName === "Gold") {
        badge = "Gold";
      } else if (packageName === "Platinum") {
        badge = "Platinum";
      } else {
        badge = "Bronze";
      }
      const filter = { email };
      const updatedDoc = {
        $set: { badge },
      };
      const userResult = await userCollection.updateOne(filter, updatedDoc);
      res.send({ paymentResult, userResult });
    });

    app.get("/payment", async (req, res) => {
      // add verifyToken
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is Needed" });
      }
      const filter = { email };
      const result = await paymentCollection.find(filter).toArray();
      res.send(result);
    });

    app.get("/payments", async (req, res) => {
      // todo: add verifyToken and verifyAdmin
      const result = await paymentCollection.find().toArray();
      res.send(result);
    });

    // Connect the client to the server	(optional starting in v4.7)
    // Send a ping to confirm a successful connection
    await client.connect();

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hostel Management..........");
});

app.listen(port, () => {
  console.log(`Hostel Management Server Running on ${port}`);
});
