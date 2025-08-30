// File: updateData.js
const admin = require("firebase-admin");

// This line looks for the key file you just downloaded.
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const reportsRef = db.collection("sharedReports");

async function updateExistingReports() {
  console.log("Starting data update process...");

  try {
    const snapshot = await reportsRef.get();

    if (snapshot.empty) {
      console.log("No reports found. Nothing to do.");
      return;
    }

    const batch = db.batch();
    let updatedCount = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      // We only update documents that DO NOT have the 'isDeleted' field.
      if (data.isDeleted === undefined) {
        batch.update(doc.ref, { isDeleted: false });
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      await batch.commit();
      console.log(`Successfully updated ${updatedCount} reports to include 'isDeleted: false'.`);
    } else {
      console.log("All reports already have the 'isDeleted' field. No updates were needed.");
    }

  } catch (error) {
    console.error("An error occurred during the update process:", error);
  }
}

updateExistingReports();
