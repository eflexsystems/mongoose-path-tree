var Schema = require('mongoose').Schema;
var streamWorker = require('stream-worker');

module.exports = exports = tree;


/**
 * @class Tree
 * Tree Behavior for Mongoose
 *
 * Implements the materialized path strategy with cascade child re-parenting
 * on delete for storing a hierarchy of documents with Mongoose
 *
 * @param  {Mongoose.Schema} schema
 * @param  {Object} options
 */
function tree(schema, options) {

  var pathSeparator = options && options.pathSeparator || '#'
    , numWorkers = options && options.numWorkers || 5
    , idType = options && options.idType || Schema.ObjectId
    , pathSeparatorRegex = '[' + pathSeparator + ']';

  function getModel(root) {
    var modelName = root.constructor.baseModelName || root.constructor.modelName;
    return root.model(modelName);
  }

  /**
   * Add parent and path properties
   *
   * @property {ObjectID} parent
   * @property {String} path
   */
  schema.add({
    parent: {
      type: idType,
      set: function (val) {
        if (val instanceof Object && val._id) {
          if (val.path) {
            this.path = val.path + pathSeparator + this._id.toString();
          }
          return val._id;
        } else {
          return val;
        }
      }
    },
    path: {
      type: String
    }
  });


  /**
   * Pre-save middleware
   * Build or rebuild path when needed
   *
   * @param  {Function} next
   */
  schema.pre('save', function preSave(next) {
    var isParentChange = this.isModified('parent');

    if (this.isNew || isParentChange) {
      if (!this.parent) {
        this.path = this._id.toString();
        return next();
      }

      if (this.isNew && this.path) {
        return next();
      }

      var self = this;
      this.collection.findOne({ _id: this.parent }, { path: 1 }, function (err, doc) {

        if (err) {
          return next(err);
        }

        var previousPath = self.path;
        self.path = doc.path + pathSeparator + self._id.toString();

        if (isParentChange) {
          // When the parent is changed we must rewrite all children paths as well
          self.collection.find({ path: { '$regex': '^' + previousPath + pathSeparatorRegex } }, { path: 1 }, function (err, cursor) {

            if (err) {
              return next(err);
            }

            streamWorker(cursor.stream(), function streamOnData(doc, done) {

              var newPath = self.path + doc.path.substr(previousPath.length);
              self.collection.update({ _id: doc._id }, { $set: { path: newPath } }, done);
            },
            { promises: false, concurrency: numWorkers },
            next);
          });
        }
        else {
          next();
        }
      });
    }
    else {
      next();
    }
  });


  /**
   * Pre-remove middleware
   *
   * @param  {Function} next
   */
  schema.pre('remove', function preRemove(next) {

    if (!this.path)
      return next();

    this.collection.remove({ path: { '$regex': '^' + this.path + pathSeparatorRegex } }, next);
  });


  /**
   * @method getChildren
   *
   *         {Object}        filters (like for mongo find) (optional)
   *  {Object} or {String}   fields  (like for mongo find) (optional)
   *         {Object}        options (like for mongo find) (optional)
   * @param  {Boolean}       recursive, default false      (optional)
   * @param  {Function}      next
   * @return {Model}
   */
  schema.methods.getChildren = function getChildren(filters, fields, options, recursive, next) {

    // normalize the arguments
    if ('function' === typeof filters) {
      next = filters;
      filters = {};
    }
    else if ('function' === typeof fields) {
      next = fields;
      fields = null;

      if ('boolean' === typeof filters) {
        recursive = filters;
        filters = {};
      }
    }
    else if ('function' === typeof options) {
      next = options;
      options = {};

      if ('boolean' === typeof fields) {
        recursive = fields;
        fields = null;
      }
    }
    else if ('function' === typeof recursive) {
      next = recursive;

      if ('boolean' === typeof options) {
        recursive = options;
        options = {};
      }
      else {
        recursive = false;
      }
    }

    filters = filters || {};
    fields = fields || null;
    options = options || {};
    recursive = recursive || false;

    if (recursive) {
      if(filters['$query']){
        filters['$query']['path'] = {$regex: '^' + this.path + pathSeparatorRegex};
      } else {
        filters['path'] = {$regex: '^' + this.path + pathSeparatorRegex};
      }
    } else {
      if(filters['$query']){
        filters['$query']['parent'] = this._id;
      } else {
        filters['parent'] = this._id;
      }
    }

    return getModel(this).find(filters, fields, options, next);
  };


  /**
   * @method getParent
   *
   * @param  {Function} next
   * @return {Model}
   */
  schema.methods.getParent = function getParent(next) {
    return getModel(this).findOne({ _id: this.parent }, next);
  };


  /**
   * @method getAncestors
   *
   * @param  {Object}   args
   * @param  {Function} next
   * @return {Model}
   */
  schema.methods.getAncestors = function getAncestors(filters, fields, options, next) {

    if ('function' === typeof filters) {
      next = filters;
      filters = {};
    }
    else if ('function' === typeof fields) {
      next = fields;
      fields = null;
    }
    else if ('function' === typeof options) {
      next = options;
      options = {};
    }

    filters = filters || {};
    fields = fields || null;
    options = options || {};

    var ids = [];

    if (this.path) {
      ids = this.path.split(pathSeparator);
      ids.pop();
    }

    if(filters['$query']){
      filters['$query']['_id'] = {$in: ids};
    } else {
      filters['_id'] = {$in: ids};
    }

    return getModel(this).find(filters, fields, options, next);
  };


  /**
   * @method getChildrenTree
   *
   * @param  {Document} root (optional)
   * @param  {Object}   args (optional)
   *         {Object}        .filters (like for mongo find)
   *  {Object} or {String}   .fields  (like for mongo find)
   *         {Object}        .options (like for mongo find)
   *         {Number}        .minLevel, default 1
   *         {Boolean}       .recursive
   *         {Boolean}       .allowEmptyChildren
   * @param  {Function} next
   * @return {Model}
   */
  schema.statics.getChildrenTree = function getChildrenTree(root, args, next) {

    if ("function" === typeof(root))
    {
      next = root;
      root = null;
      args = {};
    }
    else if ("function" === typeof(args)) {
      next = args;

      if ("model" in root) {
        args = {};
      }
      else
      {
        args = root;
        root = null;
      }
    }

    var filters = args.filters || {};
    var fields = args.fields || null;
    var options = args.options || {};
    var minLevel = args.minLevel || 1;
    var recursive = args.recursive != undefined ? args.recursive : true;
    var allowEmptyChildren = args.allowEmptyChildren != undefined ? args.allowEmptyChildren : true;

    if (!next)
      throw new Error('no callback defined when calling getChildrenTree');

    // filters: Add recursive path filter or not
    if (recursive) {
      if (root) {
        filters.path = { $regex: '^' + root.path + pathSeparatorRegex };
      }

      if (filters.parent === null) {
        delete filters.parent;
      }

    } else {
      if (root) {
        filters.parent = root._id;
      }
      else {
        filters.parent = null;
      }
    }

    // fields: Add path and parent in the result if not already specified
    if (fields) {
      if (fields instanceof Object) {
        if (!fields.hasOwnProperty('path')) {
          fields['path'] = 1;
        }
        if (!fields.hasOwnProperty('parent')) {
          fields['parent'] = 1;
        }
      }
      else {
        if (!fields.match(/path/)) {
          fields += ' path';
        }
        if (!fields.match(/parent/)) {
          fields += ' parent';
        }
      }
    }

    // options:sort , path sort is mandatory
    if (!options.sort) {
      options.sort = {};
    }
    options.sort.path = 1;

    var model = null;

    if (root) {
      model = getModel(root);
    } else {
      var modelName = this.baseModelName || this.modelName;
      model = this.model(modelName);
    }

    return model.find(filters, fields, options, function (err, results) {

      if (err) {
        return next(err);
      }

      var getLevel = function (path) {

        return path ? path.split(pathSeparator).length : 0;
      };

      var createChildren = function createChildren(arr, node, level) {

        if (level == minLevel) {
          if (allowEmptyChildren) {
            node.children = [];
          }
          return arr.push(node);
        }

        var nextIndex = arr.length - 1;
        var myNode = arr[nextIndex];

        if (!myNode) {
          return [];
        } else {
          createChildren(myNode.children, node, level - 1);
        }
      };

      var finalResults = [];
      var rootLevel = 1;

      if (root) {
        rootLevel = getLevel(root.path) + 1;
      }

      if (minLevel < rootLevel) {
        minLevel = rootLevel;
      }

      for (var r in results) {
        var level = getLevel(results[r].path);
        createChildren(finalResults, results[r], level);
      }

      next(err, finalResults);

    });
  };


  schema.methods.getChildrenTree = function(args, next) {
    this.constructor.getChildrenTree(this, args, next);
  };


  /**
   * @property {Number} level <virtual>
   */
  schema.virtual('level').get(function virtualPropLevel() {

    return this.path ? this.path.split(pathSeparator).length : 0;
  });
}
