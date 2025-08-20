const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// A single, simple route to test the server
app.get('/', (req, res) => {
    res.send('Test server is running successfully!');
});

app.listen(PORT, () => {
    console.log(`Test server started on port ${PORT}`);
});