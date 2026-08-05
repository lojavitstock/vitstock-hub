// O ambiente Windows desta sessão não expõe os dados do usuário ao Node 24.
// O tsx só precisa desse nome para criar um diretório temporário de execução.
const os = require('node:os');
os.userInfo = () => ({ username: 'vitstock-tests' });

