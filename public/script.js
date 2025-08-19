document.addEventListener('DOMContentLoaded', () => {

    // --- Reusable Download Function ---
    // This function is used on both the "Get Details" page and after successful registration.
    async function downloadReceipt(participantId, messageElement) {
        try {
            const response = await fetch('/api/get-details', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Could not fetch receipt.');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `receipt_${participantId}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();

        } catch (error) {
            console.error('Download error:', error);
            if (messageElement) {
                messageElement.className = 'message-area error'; // Ensure error styling
                messageElement.textContent = `Error: ${error.message}`;
            }
        }
    }

    // --- Countdown Timer for Homepage (index.html) ---
    const countdownElement = document.getElementById('countdown');
    if (countdownElement) {
        const eventDate = new Date('August 23, 2025 10:00:00').getTime();
        const updateCountdown = () => {
            const now = new Date().getTime();
            const distance = eventDate - now;

            if (distance < 0) {
                countdownElement.innerHTML = "EVENT HAS STARTED!";
                clearInterval(timerInterval);
                return;
            }
            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((distance % (1000 * 60)) / 1000);
            countdownElement.innerHTML = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        };
        const timerInterval = setInterval(updateCountdown, 1000);
        updateCountdown();
    }

    // --- "Get Your Details" Page Logic (details.html) ---
    const detailsForm = document.getElementById('details-form');
    const errorMessageDiv = document.getElementById('error-message');

    if (detailsForm) {
        detailsForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorMessageDiv.textContent = '';
            const participantId = document.getElementById('lookup-participant-id').value;
            await downloadReceipt(participantId, errorMessageDiv);
        });
    }

    // --- Registration Page Logic (register.html) ---
    const choiceSection = document.getElementById('choice-section');
    const verifySection = document.getElementById('verify-section');
    const paymentSection = document.getElementById('payment-section');
    const paymentStepTitle = document.getElementById('payment-step-title');
    const btnOldParticipant = document.getElementById('btn-old-participant');
    const btnNewParticipant = document.getElementById('btn-new-participant');
    const verifyForm = document.getElementById('verify-form');
    
    // Event listener for the "Old Participant" choice
    if (btnOldParticipant) {
        btnOldParticipant.addEventListener('click', () => {
            choiceSection.classList.add('hidden');
            verifySection.classList.remove('hidden');
        });
    }

    // Event listener for the "New Participant" choice
    if (btnNewParticipant) {
        btnNewParticipant.addEventListener('click', () => {
            choiceSection.classList.add('hidden');
            if (paymentStepTitle) paymentStepTitle.textContent = "Step 1: Complete Your Payment";
            paymentSection.classList.remove('hidden');
        });
    }
    
    // Event listener for the ID submission form (for old participants)
    if (verifyForm) {
        verifyForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const participantId = document.getElementById('old-participant-id').value;
            
            // 1. Find the Razorpay form
            const razorpayForm = document.getElementById('razorpay-form');
            if (!razorpayForm) {
                console.error("Razorpay form not found!");
                return;
            }

            // 2. Create a hidden input to pass the old ID to the webhook
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.name = 'notes[old_participant_id]';
            hiddenInput.value = participantId;
            
            // 3. Append the hidden input to the Razorpay form
            razorpayForm.appendChild(hiddenInput);

            // 4. Hide the verification section and show the payment section
            verifySection.classList.add('hidden');
            paymentSection.classList.remove('hidden');
        });
    }

    // This function polls the server to check if the webhook has processed the registration
    const statusMessage = document.getElementById('status-message');
    function pollForStatus(orderId) {
        if (!statusMessage) return;
        statusMessage.textContent = 'Verifying payment, please wait... This may take a moment.';
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/registration-status?orderId=${orderId}`);
                const data = await response.json();

                if (data.status === 'completed') {
                    clearInterval(pollInterval);
                    statusMessage.textContent = 'Registration successful! Your receipt is downloading...';
                    await downloadReceipt(data.participant.participantId, statusMessage);
                }
            } catch (error) {
                console.error('Polling error:', error);
                clearInterval(pollInterval);
                statusMessage.className = 'message-area error';
                statusMessage.textContent = 'An error occurred during verification. You can find your receipt on the "Get Details" page later.';
            }
        }, 3000); // Check every 3 seconds
    }

    // Main entry point for payment: Listen for Razorpay's success event
    window.addEventListener('razorpay.payment.success', (event) => {
        const orderId = event.detail.razorpay_order_id;
        const registrationFlow = document.querySelector('.registration-flow');
        if (orderId && registrationFlow) {
            // Hide all steps within the flow and show the status message
            const steps = registrationFlow.children;
            for(let step of steps){
                if(step.id !== 'status-message'){
                    step.classList.add('hidden');
                }
            }
            pollForStatus(orderId);
        }
    });
});