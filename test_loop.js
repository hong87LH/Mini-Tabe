async function test() {
  for (let i = 0; i < 3; i++) {
    const tempPath = `temp_upload_${Date.now()}.png`;
    console.log(tempPath);
    await new Promise(r => setTimeout(r, 10)); // simulate upload
  }
}
test();
