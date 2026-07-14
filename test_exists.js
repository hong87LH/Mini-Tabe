import fs from 'fs';
try {
  fs.existsSync("data:image/png;base64," + "A".repeat(100000));
  console.log("Success");
} catch(e) {
  console.log("Error:", e.message);
}
