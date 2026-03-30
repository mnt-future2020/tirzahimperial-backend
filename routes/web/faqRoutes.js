const express = require('express');
const router = express.Router();
const { getFaqs, getFaq, createFaq, updateFaq, deleteFaq , getActiveFaqs} = require('../../controllers/web/faqControllers');

// Get active FAQs
router.get('/active', getActiveFaqs);

// List all FAQs
router.get('/', getFaqs);

// Get single FAQ
router.get('/:id', getFaq);

// Create FAQ
router.post('/', createFaq);

// Update FAQ
router.put('/:id', updateFaq);

// Delete FAQ
router.delete('/:id', deleteFaq);

module.exports = router;
