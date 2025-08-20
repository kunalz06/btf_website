// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ Connected to MongoDB Atlas!'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// --- Mongoose Schema for Participants ---
const participantSchema = new mongoose.Schema({
    name: { type: String, required: true },
    teamNumber: { type: Number, required: true },
    participantId: { type: String, unique: true, sparse: true },
    participantType: String,
    email: { type: String, required: true },
    orderId: String,
    razorpayPaymentId: { type: String, unique: true },
    paymentStatus: { type: String, default: 'successful' },
    registrationDate: { type: Date, default: Date.now }
});
const Participant = mongoose.model('Participant', participantSchema);

// --- Mongoose Schema for the Counter ---
const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    sequence_value: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

// --- Function to Generate the Unique Participant ID ---
async function generateParticipantId() {
    const counter = await Counter.findByIdAndUpdate(
        { _id: 'participantId' },
        { $inc: { sequence_value: 1 } },
        { new: true, upsert: true }
    );
    let sequence = counter.sequence_value;
    if (sequence > 550) {
        console.warn("⚠️ Participant ID sequence exceeded 550.");
    }
    const paddedSequence = sequence.toString().padStart(2, '0');
    const alphabets = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const randomChar = alphabets[Math.floor(Math.random() * alphabets.length)];
    const randomNumber = Math.floor(Math.random() * 9) + 1;
    return `WBKON56${paddedSequence}${randomChar}${randomNumber}`;
}

// --- Razorpay Webhook Handler (must come BEFORE express.json) ---
app.post('/api/payment-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    try {
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(req.body); // raw buffer
        const digest = shasum.digest('hex');

        if (digest === req.headers['x-razorpay-signature']) {
            const parsedBody = JSON.parse(req.body.toString());
            const event = parsedBody.event;
            const payload = parsedBody.payload;

            if (event === 'payment.captured') {
                const paymentEntity = payload.payment.entity;
                const { name, teamNumber, email, participantType, old_participant_id } = paymentEntity.notes;

                if (old_participant_id) {
                    const updated = await Participant.findOneAndUpdate(
                        { participantId: old_participant_id },
                        {
                            name,
                            teamNumber: Number(teamNumber),
                            email,
                            participantType,
                            orderId: paymentEntity.order_id,
                            razorpayPaymentId: paymentEntity.id,
                            paymentStatus: 'successful',
                            registrationDate: new Date()
                        },
                        { new: true }
                    );
                    if (updated) {
                        console.log(`🔄 Updated participant: ${name} (ID: ${old_participant_id})`);
                    } else {
                        console.log(`⚠️ No participant found with ID ${old_participant_id}`);
                    }
                } else {
                    const newId = await generateParticipantId();
                    const newParticipant = new Participant({
                        name,
                        teamNumber: Number(teamNumber),
                        email,
                        participantId: newId,
                        participantType,
                        orderId: paymentEntity.order_id,
                        razorpayPaymentId: paymentEntity.id,
                        paymentStatus: 'successful'
                    });
                    await newParticipant.save();
                    console.log(`🎉 Created participant: ${name} (ID: ${newId})`);
                }
            }
        } else {
            console.log('❌ Webhook signature mismatch!');
        }
        res.json({ status: 'ok' });
    } catch (error) {
        console.error("❌ Webhook error:", error);
        res.status(500).send("Webhook processing error.");
    }
});

// --- Middleware (after webhook) ---
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // JSON parsing for other APIs

// --- Status Check Endpoint ---
app.get('/api/registration-status', async (req, res) => {
    try {
        const { orderId } = req.query;
        if (!orderId) return res.status(400).json({ message: 'Order ID is required.' });

        const participant = await Participant.findOne({ orderId, paymentStatus: 'successful' });
        if (participant) {
            res.json({ status: 'completed', participant });
        } else {
            res.json({ status: 'pending' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// --- Receipt Download Endpoint ---
app.post('/api/get-details', async (req, res) => {
    try {
        const { participantId } = req.body;
        if (!participantId) return res.status(400).json({ message: 'Participant ID is required.' });

        const participant = await Participant.findOne({ participantId });
        if (!participant) return res.status(404).json({ message: 'Participant not found.' });

        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=receipt_${participant.participantId}.pdf`);

        doc.pipe(res);
        doc.fontSize(24).font('Helvetica-Bold').text('Registration Receipt', { align: 'center' });
        doc.moveDown(2);
        doc.fontSize(18).font('Helvetica-Bold').text('BUILD THE FUTURE - Hackathon');
        doc.moveDown();
        doc.fontSize(12).font('Helvetica');
        doc.text(`Participant Name: ${participant.name}`);
        doc.text(`Team Number: ${participant.teamNumber}`);
        doc.text(`Participant ID: ${participant.participantId}`);
        doc.text(`Email: ${participant.email}`);
        doc.text(`Registration Date: ${participant.registrationDate.toDateString()}`);
        doc.moveDown();
        doc.text('Status: REGISTRATION CONFIRMED');
        doc.moveDown(3);
        doc.fontSize(10).text('Thank you for participating!', { align: 'center' });
        doc.end();
    } catch (error) {
        console.error('❌ Receipt error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// --- Fallback to serve frontend (must be last) ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});
