const url = "data:image/png;name=abc.png;base64,iVBORw0KGgo";
const matches = url.match(/^data:(\w+\/\w+);base64,(.+)$/);
console.log(matches);
