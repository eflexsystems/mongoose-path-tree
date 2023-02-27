const Mongoose = require('mongoose');
const Tree = require('../lib/tree');
const should = require('should');

const Schema = Mongoose.Schema;

Mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.01:27017/mongoose-path-tree');

describe('tree tests', function () {
  const userSchema = {
    name: String
  };

  // Schema for tests
  const UserSchema = new Schema(userSchema);
  UserSchema.plugin(Tree);
  const User = Mongoose.model('User', UserSchema);

  // Set up the fixture
  beforeEach(async function () {
    await User.deleteMany({});
    const adam = new User({name: 'Adam' });
    const eden = new User({name: 'Eden' });
    const bob = new User({name: 'Bob', parent: adam });
    const carol = new User({name: 'Carol', parent: adam });
    const dann = new User({name: 'Dann', parent: carol });
    const emily = new User({name: 'Emily', parent: dann });

    for (const doc of [adam, bob, carol, dann, emily, eden]) {
      await doc.save();
    }
  });

  describe('adding documents', function () {
    it('should set parent id and path', async function () {
      const users = await User.find({});

      const names = {};
      users.forEach(function (user) {
        names[user.name] = user;
      });

      should.not.exist(names['Adam'].parent);
      names['Bob'].parent.toString().should.equal(names['Adam']._id.toString());
      names['Carol'].parent.toString().should.equal(names['Adam']._id.toString());
      names['Dann'].parent.toString().should.equal(names['Carol']._id.toString());
      names['Emily'].parent.toString().should.equal(names['Dann']._id.toString());

      const expectedPath = [names['Adam']._id, names['Carol']._id, names['Dann']._id].join('#');
      names['Dann'].path.should.equal(expectedPath);
    });
  });

  describe('deleting documents', function () {
    it('should remove leaf nodes', async function () {
      const emily = await User.findOne({ name: 'Emily' });

      await emily.deleteOne();

      const users = await User.find();

      users.length.should.equal(5);
      users.map(user => user.name).should.not.containEql('Emily');
    });

    it('should remove all children', async function () {
      const user = await User.findOne({ name: 'Carol' });

      await user.deleteOne();
      const users = await User.find();

      users.length.should.equal(3);
      users.map(user => user.name).should.containEql('Adam').and.containEql('Bob');
    });
  });

  describe('get children', function () {
    it('should return immediate children with filters', async function () {
      const adam = await User.findOne({name: 'Adam'});
      const users = await adam.getChildren({name: 'Bob'});

      users.length.should.equal(1);
      users.map(user => user.name).should.containEql('Bob');
    });

    it('should return immediate children', async function () {
      const adam = await User.findOne({name: 'Adam'});
      const users = await adam.getChildren();

      users.length.should.equal(2);
      should(users.map(user => user.name)).containEql('Bob').and.containEql('Carol');
    });

    it('should return recursive children', async function () {
      const carol = await User.findOne({ name: 'Carol' });
      const users = await carol.getChildren({}, null, {}, true);

      users.length.should.equal(2);
      users.map(user => user.name).should.containEql('Dann').and.containEql('Emily');
    });

    it('should return children with only name and _id fields', async function () {
      const carol = await User.findOne({ name: 'Carol' });
      const users = await carol.getChildren({}, 'name', {}, true);

      users.length.should.equal(2);
      should.not.exist(users[0].parent);
      users.map(user => user.name).should.containEql('Dann').and.containEql('Emily');
    });

    it('should return children sorted on name', async function () {
      const carol = await User.findOne({ name: 'Carol' });
      const users = await carol.getChildren({}, null, {sort: {name: -1}}, true);

      users.length.should.equal(2);
      users[0].name.should.equal('Emily');
      users.map(user => user.name).should.containEql('Dann').and.containEql('Emily');
    });
  });

  describe('level virtual', function () {
    it('should equal the number of ancestors', async function () {
      const dann = await User.findOne({ name: 'Dann' });

      dann.level.should.equal(3);
    });
  });

  describe('get ancestors', function () {
    it('should return ancestors', async function () {
      const dann = await User.findOne({ name: 'Dann' });
      const ancestors = await dann.getAncestors();

      ancestors.length.should.equal(2);
      ancestors.map(ancestor => ancestor.name).should.containEql('Carol').and.containEql('Adam');
    });


    it('should return ancestors with only name and _id fields', async function () {
      const dann = await User.findOne({ name: 'Dann' });
      const ancestors = await dann.getAncestors({}, 'name');

      ancestors.length.should.equal(2);
      should.not.exist(ancestors[0].parent);
      ancestors[0].should.have.property('name');
      ancestors.map(ancestor => ancestor.name).should.containEql('Carol').and.containEql('Adam');
    });


    it('should return ancestors sorted on name and without wrappers', async function () {
      const dann = await User.findOne({ name: 'Dann' });

      const ancestors = await dann.getAncestors({}, null, {sort: {name: -1}, lean: 1});

      ancestors.length.should.equal(2);
      ancestors[0].name.should.equal('Carol');
      should.not.exist(ancestors[0].getAncestors);
      ancestors.map(ancestor => ancestor.name).should.containEql('Carol').and.containEql('Adam');
    });
  });
});
